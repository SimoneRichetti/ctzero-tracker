import type { RunStatus, SyncRun, SyncTrigger } from '@ctzero/shared';
import type { Db } from './db';

interface RunRecord {
  id: number;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  cards_total: number;
  cards_done: number;
  cards_error: number;
  error: string | null;
  report_sent: number;
  report_error: string | null;
}

function toRun(r: RunRecord): SyncRun {
  return {
    id: r.id,
    trigger: r.trigger as SyncTrigger,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status as RunStatus,
    cardsTotal: r.cards_total,
    cardsDone: r.cards_done,
    cardsError: r.cards_error,
    error: r.error,
    reportSent: r.report_sent === 1,
    reportError: r.report_error,
  };
}

function one(db: Db, sql: string, ...params: (string | number)[]): SyncRun | null {
  const row = db.prepare(sql).get(...params) as unknown as RunRecord | undefined;
  return row ? toRun(row) : null;
}

export function startRun(db: Db, trigger: SyncTrigger, cardsTotal: number, now: Date = new Date()): SyncRun {
  const res = db
    .prepare(`INSERT INTO sync_runs (trigger, started_at, status, cards_total) VALUES (?, ?, 'running', ?)`)
    .run(trigger, now.toISOString(), cardsTotal);
  return getRun(db, Number(res.lastInsertRowid))!;
}

export function updateRunProgress(db: Db, id: number, cardsDone: number, cardsError: number): void {
  db.prepare('UPDATE sync_runs SET cards_done = ?, cards_error = ? WHERE id = ?').run(cardsDone, cardsError, id);
}

export interface RunOutcome {
  status: Exclude<RunStatus, 'running'>;
  error?: string | null;
  reportSent?: boolean;
  reportError?: string | null;
}

export function finishRun(db: Db, id: number, o: RunOutcome, now: Date = new Date()): void {
  db.prepare(
    'UPDATE sync_runs SET status = ?, finished_at = ?, error = ?, report_sent = ?, report_error = ? WHERE id = ?',
  ).run(o.status, now.toISOString(), o.error ?? null, o.reportSent ? 1 : 0, o.reportError ?? null, id);
}

export function getRun(db: Db, id: number): SyncRun | null {
  return one(db, 'SELECT * FROM sync_runs WHERE id = ?', id);
}

export function getRunningRun(db: Db): SyncRun | null {
  return one(db, `SELECT * FROM sync_runs WHERE status = 'running' ORDER BY id DESC LIMIT 1`);
}

/** Last finished run, whatever its outcome: basis for scheduling. */
export function getLastFinishedRun(db: Db): SyncRun | null {
  return one(db, `SELECT * FROM sync_runs WHERE status != 'running' ORDER BY finished_at DESC, id DESC LIMIT 1`);
}

/** Closes runs left 'running' (process died mid-run). */
export function failOrphanRuns(db: Db): number {
  const res = db
    .prepare(
      `UPDATE sync_runs SET status = 'failed', finished_at = started_at,
         error = 'Interrupted: the process was stopped during the run'
       WHERE status = 'running'`,
    )
    .run();
  return Number(res.changes);
}
