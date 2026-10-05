import type { SyncTrigger } from '@ctzero/shared';
import type { Db } from '../db/db';
import { getLastFinishedRun } from '../db/runs-repo';
import { getSettings } from '../db/settings-repo';
import type { SyncService } from '../sync/sync-service';
import { nextRunAt } from './schedule';

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export interface SchedulerDeps {
  db: Db;
  sync: Pick<SyncService, 'start' | 'onFinished'>;
  now?: () => Date;
  /** Attesa prima del giro di recupero all'avvio. */
  catchupDelayMs?: number;
}

export class Scheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextAt: Date | null = null;
  private running = false;

  constructor(private readonly deps: SchedulerDeps) {
    // Ogni giro concluso (anche manuale) sposta la prossima esecuzione.
    deps.sync.onFinished(() => {
      if (this.running) this.plan(false);
    });
  }

  /** `catchup`: forza il giro di recupero (es. l'ultimo giro è stato interrotto). */
  start(options: { catchup?: boolean } = {}): void {
    this.running = true;
    this.plan(true, options.catchup ?? false);
  }

  stop(): void {
    this.running = false;
    this.clear();
    this.nextAt = null;
  }

  reschedule(): void {
    if (this.running) this.plan(false);
  }

  getNextRunAt(): Date | null {
    return this.nextAt;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private plan(isStartup: boolean, forceCatchup = false): void {
    this.clear();
    const now = this.now();
    const last = getLastFinishedRun(this.deps.db);
    const due = nextRunAt(last?.finishedAt ? new Date(last.finishedAt) : null, getSettings(this.deps.db), now);
    let delay = due.getTime() - now.getTime();
    let trigger: SyncTrigger = 'scheduled';
    if (delay <= 0 || forceCatchup) {
      trigger = isStartup ? 'catchup' : 'scheduled';
      delay = isStartup ? (this.deps.catchupDelayMs ?? 30_000) : 0;
    }
    this.nextAt = new Date(now.getTime() + delay);
    this.timer = setTimeout(() => this.fire(trigger), Math.min(delay, MAX_TIMEOUT_MS));
  }

  private fire(trigger: SyncTrigger): void {
    this.timer = null;
    this.nextAt = null;
    // Se un giro è già in corso, la ripianificazione avverrà alla sua fine (onFinished).
    this.deps.sync.start(trigger);
  }
}
