import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * deploy/pull-backups.sh, the desktop's weekly copy (docs/BACKUPS.md §3). Here because it
 * touches the filesystem; a local folder stands in for the server (rsync copies it the same way).
 */
const SCRIPT = path.resolve(import.meta.dirname, '../../../../deploy/pull-backups.sh');
const BACKUP = 'portfolio-2026-11-22-1800Z.dump';
const DAY_MS = 24 * 60 * 60 * 1000;

function runPullBackups(
  source: string,
  dest: string,
): Promise<{ code: number | null; output: string }> {
  const child = spawn('bash', [SCRIPT], {
    env: { ...process.env, SOURCE: `${source}/`, DEST: dest },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  // 'close', not 'exit': the script's output goes through tee, which may finish after bash.
  return new Promise((resolve) => {
    child.once('close', (code) => {
      resolve({ code, output });
    });
  });
}

describe('deploy/pull-backups.sh', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'pull-backups-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** The server's backups folder with one backup (and its checksum), made `ageDays` ago. */
  async function serverWithBackup(ageDays: number): Promise<string> {
    const server = path.join(root, 'server');
    await mkdir(server);
    const contents = 'a stand-in for a pg_dump file';
    await writeFile(path.join(server, BACKUP), contents);
    const digest = createHash('sha256').update(contents).digest('hex');
    await writeFile(path.join(server, `${BACKUP}.sha256`), `${digest}  ${BACKUP}\n`);
    const madeAt = new Date(Date.now() - ageDays * DAY_MS);
    await utimes(path.join(server, BACKUP), madeAt, madeAt);
    return server;
  }

  /** The desktop's ~/portfolio-backups as the guide sets it up: a link to a Windows folder. */
  async function linkedDesktopFolder(): Promise<{ link: string; folder: string }> {
    const folder = path.join(root, 'windows-documents');
    await mkdir(folder);
    const link = path.join(root, 'portfolio-backups');
    await symlink(folder, link);
    return { link, folder };
  }

  it('finds a fresh backup through the linked folder', async () => {
    // Regression: `find` did not look inside the link, so a fresh copy read as "no backup".
    const server = await serverWithBackup(0);
    const desktop = await linkedDesktopFolder();

    const { code, output } = await runPullBackups(server, desktop.link);

    expect(output).toContain(`OK: 1 backups here, newest ${BACKUP}`);
    expect(code).toBe(0);
    expect(await readdir(desktop.folder)).toEqual(
      expect.arrayContaining([BACKUP, `${BACKUP}.sha256`, 'pull.log']),
    );
  });

  it('warns when the newest backup is more than 8 days old', async () => {
    const server = await serverWithBackup(10);
    const desktop = await linkedDesktopFolder();

    const { code, output } = await runPullBackups(server, desktop.link);

    expect(output).toContain('no backup newer than 8 days');
    expect(code).toBe(3);
  });
});
