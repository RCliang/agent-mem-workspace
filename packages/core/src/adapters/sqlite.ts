import { DatabaseSync } from 'node:sqlite';

export function openReadonly(file: string): DatabaseSync | null {
  try {
    return new DatabaseSync(file, { readOnly: true, timeout: 3000 });
  } catch {
    return null;
  }
}

export function sqlAll(db: DatabaseSync, sql: string, ...params: (string | number)[]): Record<string, unknown>[] {
  return db.prepare(sql).all(...params) as Record<string, unknown>[];
}
