-- What we learn about each visitor (DESIGN.md §5.3b), in three groups: from the link they
-- followed, from their browser, and from their IP address. The IP itself is still not stored.
--
-- Every column is nullable: rows inserted before this migration, and events whose details are
-- unknown (no IP database configured, a private IP, a curl request), simply have NULLs. Adding
-- nullable columns is backward compatible: the previous version keeps inserting without them.

ALTER TABLE analytics_events
  -- From the link: tagged links such as /?ref=acme&utm_source=linkedin
  ADD COLUMN ref           TEXT,
  ADD COLUMN utm_source    TEXT,
  ADD COLUMN utm_medium    TEXT,
  ADD COLUMN utm_campaign  TEXT,
  -- From the browser: parsed user agent, Accept-Language header, the page's timezone
  ADD COLUMN browser       TEXT,          -- e.g. 'Chrome'
  ADD COLUMN os            TEXT,          -- e.g. 'macOS'
  ADD COLUMN device_type   TEXT,          -- 'desktop' | 'mobile' | 'tablet' | 'tv' | 'bot'
  ADD COLUMN language      TEXT,          -- e.g. 'en-SG'
  ADD COLUMN timezone      TEXT,          -- e.g. 'Asia/Singapore'
  -- From the IP address, looked up in local GeoIP database files
  ADD COLUMN country_code  TEXT,          -- ISO 3166-1 alpha-2, e.g. 'SG'
  ADD COLUMN city          TEXT,
  ADD COLUMN organization  TEXT;          -- who owns the network, e.g. 'Google LLC'
