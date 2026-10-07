import type { CardBlueprint, SyncRun, SyncTrigger, TrackedCard, TrackedSealed } from '@ctzero/shared';
import { buildFatalMessage, buildReport, type ItemKind, type ReportError, type ReportItem } from '../alerts/report';
import { evaluateAlert, type AlertEvaluation } from '../alerts/rules';
import type { Catalog } from '../catalog/catalog';
import type { CardTraderClient } from '../clients/cardtrader';
import { isFatalHttpError } from '../clients/http';
import type { TelegramClient } from '../clients/telegram';
import { getBlueprints, getCard, insertSnapshot, listCards, replaceBlueprints, updateCard } from '../db/cards-repo';
import { transaction, type Db } from '../db/db';
import { getSealed, insertSealedSnapshot, listSealed, updateSealed } from '../db/sealed-repo';
import { finishRun, getRun, getRunningRun, startRun, updateRunProgress } from '../db/runs-repo';
import { getSettings } from '../db/settings-repo';
import { errorMessage } from '../errors';
import { priceCard, type PriceResult } from '../pricing/card-pricer';
import { priceSealed } from '../pricing/sealed-pricer';

const BLUEPRINT_REFRESH_MS = 7 * 24 * 3600 * 1000;

export interface SyncServiceDeps {
  db: Db;
  catalog: Pick<Catalog, 'lookup' | 'resolveBlueprints'>;
  ct: Pick<CardTraderClient, 'products'>;
  telegram: Pick<TelegramClient, 'sendMessage'>;
  now?: () => Date;
}

type Versioned = { configVersion: number; thresholdCents: number };

/** True if the item has not been deleted nor had its filters or threshold changed. */
function isUnchanged(latest: Versioned | null, seen: Versioned): boolean {
  return latest !== null && latest.configVersion === seen.configVersion && latest.thresholdCents === seen.thresholdCents;
}

function evaluate(
  item: Pick<TrackedCard, 'alertState' | 'lastNotifiedPriceCents' | 'thresholdCents'>,
  result: PriceResult,
  furtherDropPercent: number,
): AlertEvaluation {
  return evaluateAlert(
    { alertState: item.alertState, lastNotifiedPriceCents: item.lastNotifiedPriceCents },
    result.status === 'ok' ? { status: 'ok', priceCents: result.priceCents } : { status: 'no_offers' },
    item.thresholdCents,
    furtherDropPercent,
  );
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
    const sealedIds = listSealed(db).map((s) => s.id);
    const run = startRun(db, trigger, cardIds.length + sealedIds.length, this.now());
    this.active = this.execute(run.id, cardIds, sealedIds).finally(() => {
      this.active = null;
      const finished = getRun(db, run.id);
      if (finished) for (const listener of this.listeners) listener(finished);
    });
    return { started: true, run };
  }

  async waitForIdle(): Promise<void> {
    await this.active;
  }

  /** Never rejects: every error ends up in the run outcome. */
  private async execute(runId: number, cardIds: number[], sealedIds: number[]): Promise<void> {
    const { db, telegram } = this.deps;
    try {
      const { furtherDropPercent } = getSettings(db);
      const items: ReportItem[] = [];
      const errors: ReportError[] = [];
      let done = 0;
      const errorPatch = (message: string) => ({
        lastSyncedAt: this.now().toISOString(),
        lastSyncStatus: 'error' as const,
        lastError: message,
      });

      for (const id of cardIds) {
        const card = getCard(db, id); // null if deleted during the run
        if (card) {
          const fatal = await this.runItem(
            'card',
            card.name,
            () => this.processCard(card, furtherDropPercent),
            (message) => {
              if (!getCard(db, id)) return false;
              updateCard(db, id, errorPatch(message), this.now());
              return true;
            },
            items,
            errors,
          );
          if (fatal) return await this.failRun(runId, fatal);
        }
        updateRunProgress(db, runId, ++done, errors.length);
      }

      for (const id of sealedIds) {
        const item = getSealed(db, id);
        if (item) {
          const fatal = await this.runItem(
            'sealed',
            item.name,
            () => this.processSealed(item, furtherDropPercent),
            (message) => {
              if (!getSealed(db, id)) return false;
              updateSealed(db, id, errorPatch(message), this.now());
              return true;
            },
            items,
            errors,
          );
          if (fatal) return await this.failRun(runId, fatal);
        }
        updateRunProgress(db, runId, ++done, errors.length);
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

  /**
   * Prices one item, collecting its report entry or error.
   * `markError` saves the error on the item and returns false if the item no longer exists.
   * Returns the message of a fatal error (401/403), which must stop the run.
   */
  private async runItem(
    kind: ItemKind,
    name: string,
    process: () => Promise<ReportItem | null>,
    markError: (message: string) => boolean,
    items: ReportItem[],
    errors: ReportError[],
  ): Promise<string | null> {
    try {
      const item = await process();
      if (item) items.push(item);
    } catch (e) {
      if (isFatalHttpError(e)) return errorMessage(e);
      if (markError(errorMessage(e))) errors.push({ kind, name, message: errorMessage(e) });
    }
    return null;
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
    const { next, event } = evaluate(card, result, furtherDropPercent);
    const applied = transaction(db, () => {
      // The card may have been deleted or modified while we were pricing it: in that case
      // the result is based on stale data and must not be written (or notified).
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
    return applied && event ? { kind: 'card', name: card.name, listing, event } : null;
  }

  private async processSealed(item: TrackedSealed, furtherDropPercent: number): Promise<ReportItem | null> {
    const { db, ct } = this.deps;
    const result = await priceSealed(ct, item, item.languages);
    const now = this.now();
    const iso = now.toISOString();
    const priceCents = result.status === 'ok' ? result.priceCents : null;
    const listing = result.status === 'ok' ? result.listing : null;
    const { next, event } = evaluate(item, result, furtherDropPercent);
    const applied = transaction(db, () => {
      // Same guard as cards: stale results are neither written nor notified.
      if (!isUnchanged(getSealed(db, item.id), item)) return false;
      insertSealedSnapshot(db, { sealedId: item.id, configVersion: item.configVersion, syncedAt: iso, priceCents });
      updateSealed(
        db,
        item.id,
        { lastPriceCents: priceCents, lastListing: listing, lastSyncedAt: iso, lastSyncStatus: result.status, lastError: null, ...next },
        now,
      );
      return true;
    });
    return applied && event ? { kind: 'sealed', name: item.name, listing, event } : null;
  }

  /** For "any expansion" cards, recomputes blueprints every 7 days (new reprints). */
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
