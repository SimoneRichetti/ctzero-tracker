import type { CardBlueprint, SyncRun, SyncTrigger, TrackedCard } from '@ctzero/shared';
import { buildFatalMessage, buildReport, type ReportError, type ReportItem } from '../alerts/report';
import { evaluateAlert } from '../alerts/rules';
import type { Catalog } from '../catalog/catalog';
import type { CardTraderClient } from '../clients/cardtrader';
import { isFatalHttpError } from '../clients/http';
import type { TelegramClient } from '../clients/telegram';
import { getBlueprints, getCard, insertSnapshot, listCards, replaceBlueprints, updateCard } from '../db/cards-repo';
import { transaction, type Db } from '../db/db';
import { finishRun, getRun, getRunningRun, startRun, updateRunProgress } from '../db/runs-repo';
import { getSettings } from '../db/settings-repo';
import { errorMessage } from '../errors';
import { priceCard } from '../pricing/card-pricer';

const BLUEPRINT_REFRESH_MS = 7 * 24 * 3600 * 1000;

export interface SyncServiceDeps {
  db: Db;
  catalog: Pick<Catalog, 'lookup' | 'resolveBlueprints'>;
  ct: Pick<CardTraderClient, 'products'>;
  telegram: Pick<TelegramClient, 'sendMessage'>;
  now?: () => Date;
}

/** Vero se la carta non è stata eliminata né modificata nei filtri o nella soglia. */
function isUnchanged(latest: TrackedCard | null, seen: TrackedCard): boolean {
  return latest !== null && latest.configVersion === seen.configVersion && latest.thresholdCents === seen.thresholdCents;
}

export interface StartResult {
  started: boolean;
  run: SyncRun;
}

export class SyncService {
  private active: Promise<void> | null = null;
  private readonly listeners: ((run: SyncRun) => void)[] = [];

  constructor(private readonly deps: SyncServiceDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  onFinished(listener: (run: SyncRun) => void): void {
    this.listeners.push(listener);
  }

  start(trigger: SyncTrigger): StartResult {
    const { db } = this.deps;
    const running = getRunningRun(db);
    if (running) return { started: false, run: running };
    const cardIds = listCards(db).map((c) => c.id);
    const run = startRun(db, trigger, cardIds.length, this.now());
    this.active = this.execute(run.id, cardIds).finally(() => {
      this.active = null;
      const finished = getRun(db, run.id);
      if (finished) for (const listener of this.listeners) listener(finished);
    });
    return { started: true, run };
  }

  async waitForIdle(): Promise<void> {
    await this.active;
  }

  /** Non rigetta mai: ogni errore finisce nell'esito del giro. */
  private async execute(runId: number, cardIds: number[]): Promise<void> {
    const { db, telegram } = this.deps;
    try {
      const { furtherDropPercent } = getSettings(db);
      const items: ReportItem[] = [];
      const errors: ReportError[] = [];
      let done = 0;

      for (const id of cardIds) {
        const card = getCard(db, id); // null se eliminata durante il giro
        if (card) {
          try {
            const item = await this.processCard(card, furtherDropPercent);
            if (item) items.push(item);
          } catch (e) {
            if (isFatalHttpError(e)) {
              await this.failRun(runId, errorMessage(e));
              return;
            }
            if (getCard(db, id)) {
              errors.push({ cardName: card.name, message: errorMessage(e) });
              const now = this.now();
              updateCard(db, id, { lastSyncedAt: now.toISOString(), lastSyncStatus: 'error', lastError: errorMessage(e) }, now);
            }
          }
        }
        done++;
        updateRunProgress(db, runId, done, errors.length);
      }

      const report = buildReport(items, errors, this.now());
      let reportSent = false;
      let reportError: string | null = null;
      if (report) {
        try {
          await telegram.sendMessage(report);
          reportSent = true;
        } catch (e) {
          reportError = errorMessage(e);
        }
      }
      finishRun(db, runId, { status: errors.length > 0 ? 'partial' : 'ok', reportSent, reportError }, this.now());
    } catch (e) {
      finishRun(db, runId, { status: 'failed', error: errorMessage(e) }, this.now());
    }
  }

  private async failRun(runId: number, message: string): Promise<void> {
    let reportSent = false;
    let reportError: string | null = null;
    try {
      await this.deps.telegram.sendMessage(buildFatalMessage(message, this.now()));
      reportSent = true;
    } catch (e) {
      reportError = errorMessage(e);
    }
    finishRun(this.deps.db, runId, { status: 'failed', error: message, reportSent, reportError }, this.now());
  }

  private async processCard(card: TrackedCard, furtherDropPercent: number): Promise<ReportItem | null> {
    const { db, ct } = this.deps;
    const blueprints = await this.blueprintsFor(card);
    const result = await priceCard(ct, blueprints, card);
    const now = this.now();
    const iso = now.toISOString();
    const priceCents = result.status === 'ok' ? result.priceCents : null;
    const listing = result.status === 'ok' ? result.listing : null;
    const { next, event } = evaluateAlert(
      { alertState: card.alertState, lastNotifiedPriceCents: card.lastNotifiedPriceCents },
      result.status === 'ok' ? { status: 'ok', priceCents: result.priceCents } : { status: 'no_offers' },
      card.thresholdCents,
      furtherDropPercent,
    );
    const applied = transaction(db, () => {
      // La carta può essere stata eliminata o modificata mentre la prezzavamo: in quel caso
      // il risultato è calcolato su dati vecchi e non va scritto (né notificato).
      if (!isUnchanged(getCard(db, card.id), card)) return false;
      insertSnapshot(db, { cardId: card.id, configVersion: card.configVersion, syncedAt: iso, priceCents });
      updateCard(
        db,
        card.id,
        { lastPriceCents: priceCents, lastListing: listing, lastSyncedAt: iso, lastSyncStatus: result.status, lastError: null, ...next },
        now,
      );
      return true;
    });
    return applied && event ? { cardName: card.name, listing, event } : null;
  }

  /** Per le carte "qualsiasi espansione" ricalcola i blueprint ogni 7 giorni (nuove ristampe). */
  private async blueprintsFor(card: TrackedCard): Promise<CardBlueprint[]> {
    const { db, catalog } = this.deps;
    const current = getBlueprints(db, card.id);
    const resolvedAt = card.blueprintsResolvedAt ? Date.parse(card.blueprintsResolvedAt) : 0;
    if (card.expansionIds.length > 0 || this.now().getTime() - resolvedAt < BLUEPRINT_REFRESH_MS) return current;
    try {
      const lookup = await catalog.lookup(card.name);
      const fresh = await catalog.resolveBlueprints(lookup, []);
      const now = this.now();
      const replaced = transaction(db, () => {
        const latest = getCard(db, card.id);
        if (!latest || latest.configVersion !== card.configVersion) return false;
        replaceBlueprints(db, card.id, fresh);
        updateCard(db, card.id, { blueprintsResolvedAt: now.toISOString() }, now);
        return true;
      });
      return replaced ? fresh : getBlueprints(db, card.id);
    } catch (e) {
      if (isFatalHttpError(e)) throw e;
      return current;
    }
  }
}
