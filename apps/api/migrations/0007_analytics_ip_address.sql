-- The visitor's IP address, kept with each event at the owner's request (DESIGN.md §5.3c, §12).
-- INET stores IPv4 and IPv6 addresses and refuses anything that is not one.
-- Expand-only: a nullable column, so the previously deployed code keeps working, and events
-- buffered before this release are stored with NULL.

ALTER TABLE analytics_events ADD COLUMN ip_address INET;
