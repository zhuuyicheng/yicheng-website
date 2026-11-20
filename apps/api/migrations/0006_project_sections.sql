-- Structured detail for project pages: an array of sections, each
-- { "heading": text, "body": text | null, "points": [text] }. See DESIGN.md §5.2c.
-- Expand-only: a new column with a default, so the previously deployed code, which never
-- selects it, keeps working during a deploy (DESIGN.md §14.4).

ALTER TABLE projects
  ADD COLUMN sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT projects_sections_is_array CHECK (jsonb_typeof(sections) = 'array');
