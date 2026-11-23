import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MigrationError, runMigrations } from '../../src/db/migrator.js';
import { integrationTestEnv } from './test-env.js';

/** Each test gets its own schema and migrations folder, never the real schema_migrations. */
describe('runMigrations', () => {
  const logger = pino({ level: 'silent' });
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let schema: string;
  let directory: string;

  beforeEach(async () => {
    schema = `migrator_test_${String(Date.now())}`;
    adminPool = new pg.Pool({ connectionString: integrationTestEnv.DATABASE_URL, max: 1 });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({
      connectionString: integrationTestEnv.DATABASE_URL,
      max: 1,
      options: `-c search_path=${schema}`,
    });
    directory = await mkdtemp(path.join(tmpdir(), 'migrations-'));
  });

  afterEach(async () => {
    await pool.end();
    await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
    await adminPool.end();
    await rm(directory, { recursive: true, force: true });
  });

  async function writeMigration(fileName: string, sql: string): Promise<void> {
    await writeFile(path.join(directory, fileName), sql);
  }

  async function tableExists(table: string): Promise<boolean> {
    const result = await pool.query(
      'SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2',
      [schema, table],
    );
    return result.rowCount === 1;
  }

  it('applies pending migrations in version order and records them', async () => {
    await writeMigration('0002_add_widget_color.sql', 'ALTER TABLE widgets ADD COLUMN color TEXT;');
    await writeMigration('0001_create_widgets.sql', 'CREATE TABLE widgets (id INT PRIMARY KEY);');

    const result = await runMigrations({ pool, directory, logger });

    expect(result.applied).toEqual(['0001_create_widgets.sql', '0002_add_widget_color.sql']);
    const recorded = await pool.query<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(recorded.rows.map((row) => row.version)).toEqual([1, 2]);
  });

  it('is a no-op when everything is already applied', async () => {
    await writeMigration('0001_create_widgets.sql', 'CREATE TABLE widgets (id INT PRIMARY KEY);');
    await runMigrations({ pool, directory, logger });

    const secondRun = await runMigrations({ pool, directory, logger });

    expect(secondRun.applied).toEqual([]);
  });

  it('rejects a migration that was edited after being applied', async () => {
    await writeMigration('0001_create_widgets.sql', 'CREATE TABLE widgets (id INT PRIMARY KEY);');
    await runMigrations({ pool, directory, logger });
    await writeMigration('0001_create_widgets.sql', 'CREATE TABLE widgets (id BIGINT);');

    await expect(runMigrations({ pool, directory, logger })).rejects.toThrow(
      /was modified after being applied/,
    );
  });

  it('rolls back a failing migration and leaves it unrecorded', async () => {
    await writeMigration(
      '0001_half_broken.sql',
      'CREATE TABLE gadgets (id INT PRIMARY KEY); SELECT * FROM missing_table;',
    );

    await expect(runMigrations({ pool, directory, logger })).rejects.toBeInstanceOf(MigrationError);
    expect(await tableExists('gadgets')).toBe(false);
    const recorded = await pool.query('SELECT 1 FROM schema_migrations');
    expect(recorded.rowCount).toBe(0);
  });

  it('rejects badly named migration files', async () => {
    await writeMigration('1_create_widgets.sql', 'SELECT 1;');

    await expect(runMigrations({ pool, directory, logger })).rejects.toThrow(
      /Invalid migration file name/,
    );
  });
});
