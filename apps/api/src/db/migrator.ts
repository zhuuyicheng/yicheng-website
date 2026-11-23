import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';
import type { Logger } from '../infra/logger.js';

/** apps/api/migrations, from both src/db and dist/db. */
export const DEFAULT_MIGRATIONS_DIRECTORY = path.resolve(import.meta.dirname, '../../migrations');

const MIGRATION_FILE_NAME = /^(?<version>\d{4})_(?<name>[a-z0-9_]+)\.sql$/;

/** Any constant: every run takes this advisory lock, so runs never overlap. */
const MIGRATION_LOCK_ID = 7_331_001;

const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER     PRIMARY KEY,
    name        TEXT        NOT NULL,
    checksum    TEXT        NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

export interface Migration {
  version: number;
  name: string;
  fileName: string;
  sql: string;
  checksum: string;
}

export interface MigrationRunResult {
  /** Applied in this run, in order; empty when up to date. */
  applied: string[];
}

export class MigrationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MigrationError';
  }
}

/** Reads every `NNNN_name.sql` file in `directory`, sorted by version. */
export async function readMigrations(directory: string): Promise<Migration[]> {
  const fileNames = (await readdir(directory)).filter((fileName) => fileName.endsWith('.sql'));
  const migrations: Migration[] = [];

  for (const fileName of fileNames) {
    const { version, name } = parseMigrationFileName(fileName);
    const sql = await readFile(path.join(directory, fileName), 'utf8');
    migrations.push({ version, name, fileName, sql, checksum: sha256(sql) });
  }

  migrations.sort((a, b) => a.version - b.version);
  assertUniqueVersions(migrations);
  return migrations;
}

/**
 * Applies each pending migration in its own transaction with its schema_migrations row.
 * Refuses to run if an applied migration was edited or deleted.
 */
export async function runMigrations(options: {
  pool: Pool;
  directory: string;
  logger: Logger;
}): Promise<MigrationRunResult> {
  const { pool, directory, logger } = options;
  const migrations = await readMigrations(directory);
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    try {
      await client.query(CREATE_MIGRATIONS_TABLE);
      const appliedChecksums = await loadAppliedChecksums(client);
      verifyAppliedMigrations(migrations, appliedChecksums);

      const pending = migrations.filter((migration) => !appliedChecksums.has(migration.version));
      for (const migration of pending) {
        await applyMigration(client, migration);
        logger.info({ migration: migration.fileName }, 'migration applied');
      }
      return { applied: pending.map((migration) => migration.fileName) };
    } finally {
      await releaseLock(client, logger);
    }
  } finally {
    client.release();
  }
}

function parseMigrationFileName(fileName: string): { version: number; name: string } {
  const groups = MIGRATION_FILE_NAME.exec(fileName)?.groups;
  const version = groups?.version;
  const name = groups?.name;

  if (version === undefined || name === undefined) {
    throw new MigrationError(
      `Invalid migration file name "${fileName}" (expected NNNN_snake_case_name.sql)`,
    );
  }
  return { version: Number(version), name };
}

function assertUniqueVersions(migrations: readonly Migration[]): void {
  const seen = new Set<number>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new MigrationError(`Duplicate migration version ${String(migration.version)}`);
    }
    seen.add(migration.version);
  }
}

async function loadAppliedChecksums(client: PoolClient): Promise<Map<number, string>> {
  const result = await client.query<{ version: number; checksum: string }>(
    'SELECT version, checksum FROM schema_migrations ORDER BY version',
  );
  return new Map(result.rows.map((row) => [row.version, row.checksum]));
}

function verifyAppliedMigrations(
  migrations: readonly Migration[],
  appliedChecksums: ReadonlyMap<number, string>,
): void {
  const filesByVersion = new Map(migrations.map((migration) => [migration.version, migration]));

  for (const [version, checksum] of appliedChecksums) {
    const file = filesByVersion.get(version);
    if (!file) {
      throw new MigrationError(`Migration ${String(version)} is applied but its file is missing`);
    }
    if (file.checksum !== checksum) {
      throw new MigrationError(
        `Migration ${file.fileName} was modified after being applied; add a new migration instead`,
      );
    }
  }
}

async function applyMigration(client: PoolClient, migration: Migration): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query(
      'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
      [migration.version, migration.name, migration.checksum],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    const reason = error instanceof Error ? error.message : String(error);
    throw new MigrationError(`Migration ${migration.fileName} failed: ${reason}`, { cause: error });
  }
}

async function releaseLock(client: PoolClient, logger: Logger): Promise<void> {
  try {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
  } catch (err) {
    // Not fatal: the lock is released when the connection closes anyway.
    logger.warn({ err }, 'failed to release migration lock explicitly');
  }
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
