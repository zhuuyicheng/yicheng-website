/**
 * `npm run geoip:download` — downloads the free DB-IP Lite databases into apps/api/data/geoip/
 * (gitignored). DESIGN.md §8.2.
 *
 *   dbip-asn-lite.mmdb   IP → organisation that owns the network    (GEOIP_ASN_DB_PATH)
 *   dbip-city-lite.mmdb  IP → country and city                      (GEOIP_LOCATION_DB_PATH)
 *
 * DB-IP publishes new files monthly; re-run to refresh, then restart the API. License: CC BY 4.0,
 * which asks for the attribution "IP Geolocation by DB-IP" (https://db-ip.com) wherever the data
 * is shown publicly.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { open } from 'maxmind';
import { GEOIP_DIRECTORY } from '../infra/ip-databases.js';
import { createLogger } from '../infra/logger.js';

const DATABASES = ['dbip-asn-lite', 'dbip-city-lite'] as const;

const logger = createLogger({ log: { level: 'info', pretty: process.stdout.isTTY } });

/** "2026-11" and "2026-10": early in a month, this month's file may not be published yet. */
function recentMonths(today: Date): string[] {
  const lastMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  return [today, lastMonth].map((date) => date.toISOString().slice(0, 7));
}

async function download(database: string): Promise<void> {
  const target = path.join(GEOIP_DIRECTORY, `${database}.mmdb`);
  const partial = `${target}.download`;

  for (const month of recentMonths(new Date())) {
    const url = `https://download.db-ip.com/free/${database}-${month}.mmdb.gz`;
    const response = await fetch(url);
    if (response.status === 404) {
      continue; // not published yet: try the previous month
    }
    if (!response.ok || response.body === null) {
      throw new Error(`${url} answered HTTP ${response.status}`);
    }

    try {
      await pipeline(Readable.fromWeb(response.body), createGunzip(), createWriteStream(partial));
      await open(partial); // throws unless the file is a valid database
      // Atomic replace: a running API keeps using its in-memory copy until it restarts.
      await rename(partial, target);
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
    logger.info({ database, month, file: target }, 'GeoIP database downloaded');
    return;
  }
  throw new Error(`${database}: no file published for ${recentMonths(new Date()).join(' or ')}`);
}

try {
  await mkdir(GEOIP_DIRECTORY, { recursive: true });
  for (const database of DATABASES) {
    logger.info({ database }, 'downloading GeoIP database (the city file is about 60 MB)');
    await download(database);
  }
  logger.info('done: set GEOIP_ASN_DB_PATH and GEOIP_LOCATION_DB_PATH (see .env.example)');
} catch (err) {
  logger.fatal({ err }, 'GeoIP download failed');
  process.exitCode = 1;
}
