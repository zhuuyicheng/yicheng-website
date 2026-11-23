import type { AsnResponse, CityResponse, Reader } from 'maxmind';
import type { Network } from '../schema/analytics-event.schema.js';

/** The two GeoIP files (infra/ip-databases.ts). `null` = not configured: those fields stay null. */
export interface IpDatabases {
  /** IP → the organisation owning the network (an ISP or a company). */
  asn: Reader<AsnResponse> | null;
  /** IP → country and city (a country-only file works too). */
  location: Reader<CityResponse> | null;
}

export const NO_IP_DATABASES: IpDatabases = { asn: null, location: null };

/**
 * IP → network owner and place, from the local GeoIP files (DESIGN.md §8.2). In memory, a
 * lookup takes microseconds, so it's safe on the ingestion path.
 */
export interface IpLocationDal {
  /** Fields are null when unknown: private addresses, or no database. */
  lookup: (ip: string) => Network;
}

export function createIpLocationDal(databases: IpDatabases): IpLocationDal {
  return {
    lookup(ip) {
      // null for uncovered addresses (10.x, 127.0.0.1) and non-IPs. Fields can be missing too:
      // the free databases don't always fill what the types promise.
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
