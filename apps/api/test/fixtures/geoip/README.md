# GeoIP test databases

Small MaxMind DB (`.mmdb`) files with made-up data for known test addresses, so tests can
exercise the real IP lookup code without downloading the production databases.

| File                      | Source                                                                   |
| ------------------------- | ------------------------------------------------------------------------ |
| `GeoLite2-ASN-Test.mmdb`  | [maxmind/MaxMind-DB](https://github.com/maxmind/MaxMind-DB) `test-data/` |
| `GeoLite2-City-Test.mmdb` | same                                                                     |

Copyright MaxMind, Inc., licensed under the Apache License 2.0 or the MIT License, at your
option. The addresses the tests rely on are listed in `test/helpers/geoip-fixtures.ts`.
