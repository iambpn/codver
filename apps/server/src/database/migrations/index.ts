import { db } from '../index';

interface Migration {
  name: string;
  up: () => void;
}

const migrations: Migration[] = [
  {
    name: '001_add_advanced_job_fields',
    up: () => {
      // Add columns for Phase 9 advanced features
      const columns = [
        'images TEXT',
        'provider TEXT',
        'thinking_level TEXT',
        'additional_files TEXT',
        'webhook_url TEXT',
        'timeout_ms INTEGER',
        'memory_limit TEXT',
        'cpu_limit TEXT',
        'network_access TEXT',
        'env_vars TEXT',
      ];

      for (const column of columns) {
        const columnName = column.split(' ')[0];
        try {
          db.exec(`ALTER TABLE jobs ADD COLUMN ${column}`);
          console.log(`Migration: Added column ${columnName} to jobs table`);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          if (errorMsg.includes('duplicate column name')) {
            console.log(`Migration: Column ${columnName} already exists, skipping`);
          } else {
            throw err;
          }
        }
      }
    },
  },
];

export function runMigrations(): void {
  // Ensure migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `);

  const appliedMigrations = db.prepare('SELECT name FROM migrations').all() as { name: string }[];
  const appliedSet = new Set(appliedMigrations.map((m) => m.name));

  for (const migration of migrations) {
    if (appliedSet.has(migration.name)) {
      continue;
    }

    console.log(`Running migration: ${migration.name}`);
    migration.up();

    db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
      migration.name,
      Date.now(),
    );
  }

  console.log('Database migrations completed');
}
