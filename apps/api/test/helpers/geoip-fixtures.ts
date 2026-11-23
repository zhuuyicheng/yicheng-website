import type { AppConfig } from '../../src/config/env.js';

/**
 * MaxMind's tiny public test databases (test/fixtures/geoip/README.md). Known entries:
 *   89.160.20.115  → SE, Linköping, "Bredband2 AB"   (both files)
 *   81.2.69.142    → GB, London, no organisation    (city file only)
 *   1.0.0.1        → no location, "Google Inc."      (ASN file only)
 */
export const GEOIP_FIXTURES: AppConfig['ipLookup'] = {
  asnDbPath: 'test/fixtures/geoip/GeoLite2-ASN-Test.mmdb',
  locationDbPath: 'test/fixtures/geoip/GeoLite2-City-Test.mmdb',
};
