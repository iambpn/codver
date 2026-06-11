import { db } from './index';

interface Migration {
  name: string;
  sql: string;
}

const migrations: Migration[] = [];

export function runMigrations(): void {
  const applied = db.prepare('SELECT name FROM migrations').all() as { name: string }[];
  const appliedNames = new Set(applied.map((a) => a.name));

  for (const migration of migrations) {
    if (!appliedNames.has(migration.name)) {
      db.exec(migration.sql);
      db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        Date.now(),
      );
      console.log(`Migration applied: ${migration.name}`);
    }
  }
}
