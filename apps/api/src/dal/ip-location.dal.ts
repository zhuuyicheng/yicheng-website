import type { AsnResponse, CityResponse, Reader } from 'maxmind';
import type { Network } from '../schema/analytics-event.schema.js';

/**
 * The two local GeoIP database files, opened at startup by `infra/ip-databases.ts`. Either can
 * be `null` (not configured), which only means its fields stay null.
 */
export interface IpDatabases {
  /** IP → autonomous system: the organisation that owns the network (an ISP or a company). */
  asn: Reader<AsnResponse> | null;
  /** IP → country and city. A country-only database also works (city then stays null). */
  location: Reader<CityResponse> | null;
}

export const NO_IP_DATABASES: IpDatabases = { asn: null, location: null };

/**
 * Data access for the local GeoIP files (MaxMind DB format, `.mmdb`): IP address → network
 * owner and location. See DESIGN.md §8.2. No network calls: the files are loaded into memory
 * and a lookup is a tree search taking microseconds, so it is safe on the ingestion path.
 */
export interface IpLocationDal {
  /** Every field is null when unknown: private or loopback addresses, or no database. */
  lookup: (ip: string) => Network;
}

export function createIpLocationDal(databases: IpDatabases): IpLocationDal {
  return {
    lookup(ip) {
      // `get` returns null for addresses the database does not cover (10.x, 127.0.0.1, ...)
      // and for strings that are not IP addresses. Record fields can be missing too: the
      // library's types promise more than the free databases always contain.
      const asn = databases.asn?.get(ip) ?? null;
      const location = databases.location?.get(ip) ?? null;
      return {
        countryCode: location?.country?.iso_code ?? null,
        city: location?.city?.names.en ?? null,
        organization: asn?.autonomous_system_organization ?? null,
      };
    },
  };
}
