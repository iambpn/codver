import { db } from './index';

interface Migration {
  name: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    name: 'add_jobs_language_column',
    sql: `ALTER TABLE jobs ADD COLUMN language TEXT;`,
  },
  {
    name: 'add_jobs_image_column',
    sql: `ALTER TABLE jobs ADD COLUMN docker_image TEXT;`,
  },
  {
    name: 'add_jobs_started_at_column',
    sql: `ALTER TABLE jobs ADD COLUMN started_at INTEGER;`,
  },
  {
    name: 'add_jobs_completed_at_column',
    sql: `ALTER TABLE jobs ADD COLUMN completed_at INTEGER;`,
  },
  {
    name: 'add_jobs_pr_branch_column',
    sql: `ALTER TABLE jobs ADD COLUMN pr_branch TEXT;`,
  },
  {
    name: 'add_jobs_pr_title_column',
    sql: `ALTER TABLE jobs ADD COLUMN pr_title TEXT;`,
  },
  {
    name: 'add_jobs_pr_description_column',
    sql: `ALTER TABLE jobs ADD COLUMN pr_description TEXT;`,
  },
  {
    name: 'add_jobs_pr_author_column',
    sql: `ALTER TABLE jobs ADD COLUMN pr_author TEXT;`,
  },
  // Phase 8: Error Handling & Failure PRs
  {
    name: 'add_jobs_error_type_column',
    sql: `ALTER TABLE jobs ADD COLUMN error_type TEXT;`,
  },
  {
    name: 'add_jobs_retry_count_column',
    sql: `ALTER TABLE jobs ADD COLUMN retry_count INTEGER DEFAULT 0;`,
  },
  {
    name: 'add_jobs_error_pr_url_column',
    sql: `ALTER TABLE jobs ADD COLUMN error_pr_url TEXT;`,
  },
];

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
