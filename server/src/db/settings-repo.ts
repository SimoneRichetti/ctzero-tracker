import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '@ctzero/shared';
import { transaction, type Db } from './db';

export function getSettings(db: Db): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as unknown as { key: string; value: string }[];
  const raw: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try {
      raw[r.key] = JSON.parse(r.value);
    } catch {
      // unreadable value: keep the default
    }
  }
  const parsed = settingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
}

export function saveSettings(db: Db, s: Settings): void {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  transaction(db, () => {
    for (const [key, value] of Object.entries(s)) upsert.run(key, JSON.stringify(value));
  });
}
