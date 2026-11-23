import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createIpLocationDal, NO_IP_DATABASES } from '../../src/dal/ip-location.dal.js';
import { openIpDatabases } from '../../src/infra/ip-databases.js';
import { GEOIP_FIXTURES } from '../helpers/geoip-fixtures.js';

const log = pino({ level: 'silent' });
const UNKNOWN = { countryCode: null, city: null, organization: null };

describe('IP location lookup (real .mmdb files)', () => {
  it('finds the country, city and network owner of an address', async () => {
    const dal = createIpLocationDal(await openIpDatabases(GEOIP_FIXTURES, log));

    expect(dal.lookup('89.160.20.115')).toEqual({
      countryCode: 'SE',
      city: 'Linköping',
      organization: 'Bredband2 AB',
    });
    // Each file is asked on its own: either may know an address the other doesn't.
    expect(dal.lookup('81.2.69.142')).toEqual({
      countryCode: 'GB',
      city: 'London',
      organization: null,
    });
    expect(dal.lookup('1.0.0.1')).toEqual({
      countryCode: null,
      city: null,
      organization: 'Google Inc.',
    });
  });

  it('understands IPv4 addresses written in IPv6 form (as dual-stack servers report them)', async () => {
    const dal = createIpLocationDal(await openIpDatabases(GEOIP_FIXTURES, log));

    expect(dal.lookup('::ffff:81.2.69.142').city).toBe('London');
  });

  it('knows nothing about private addresses or text that is not an IP', async () => {
    const dal = createIpLocationDal(await openIpDatabases(GEOIP_FIXTURES, log));

    expect(dal.lookup('127.0.0.1')).toEqual(UNKNOWN);
    expect(dal.lookup('10.1.2.3')).toEqual(UNKNOWN);
    expect(dal.lookup('not-an-ip')).toEqual(UNKNOWN);
  });

  it('returns unknown for everything when no database is configured', async () => {
    const databases = await openIpDatabases({ asnDbPath: null, locationDbPath: null }, log);

    expect(databases).toEqual(NO_IP_DATABASES);
    expect(createIpLocationDal(databases).lookup('89.160.20.115')).toEqual(UNKNOWN);
  });

  it('refuses to start with a configured file that does not exist', async () => {
    const missing = { ...GEOIP_FIXTURES, locationDbPath: 'data/geoip/missing.mmdb' };

    await expect(openIpDatabases(missing, log)).rejects.toThrow(
      'GEOIP_LOCATION_DB_PATH: cannot open "data/geoip/missing.mmdb". Run `npm run geoip:download`.',
    );
  });
});
