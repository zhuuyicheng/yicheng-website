import path from 'node:path';
import { open, type AsnResponse, type CityResponse } from 'maxmind';
import type { AppConfig } from '../config/env.js';
import type { IpDatabases } from '../dal/ip-location.dal.js';
import type { Logger } from './logger.js';

/** apps/api, from both src/infra and dist/infra. */
const API_ROOT = path.resolve(import.meta.dirname, '../..');

/** Where `npm run geoip:download` puts the files. */
export const GEOIP_DIRECTORY = path.join(API_ROOT, 'data/geoip');

/**
 * Opens the GeoIP files named in the config into memory (DESIGN.md §8.2). No path: that lookup
 * is off. A missing or bad file throws, so the API won't start collecting less than asked.
 */
export async function openIpDatabases(
  config: AppConfig['ipLookup'],
  logger: Logger,
): Promise<IpDatabases> {
  const [asn, location] = await Promise.all([
    openOptional<AsnResponse>('GEOIP_ASN_DB_PATH', config.asnDbPath, logger),
    openOptional<CityResponse>('GEOIP_LOCATION_DB_PATH', config.locationDbPath, logger),
  ]);
  return { asn, location };
}

async function openOptional<T extends AsnResponse | CityResponse>(
  variable: string,
  file: string | null,
  logger: Logger,
) {
  if (file === null) {
    logger.warn(
      { variable },
      'IP lookup disabled: database path not set (run `npm run geoip:download`, see .env.example)',
    );
    return null;
  }

  try {
    const reader = await open<T>(path.resolve(API_ROOT, file));
    logger.info(
      { variable, file, builtAt: reader.metadata.buildEpoch.toISOString() },
      'IP database loaded',
    );
    return reader;
  } catch (error) {
    throw new Error(`${variable}: cannot open "${file}". Run \`npm run geoip:download\`.`, {
      cause: error,
    });
  }
}
