-- When content:seed last changed any published content (the profile, an experience, an
-- education entry or a project, including removing one): the home page's "Last updated"
-- date. See DESIGN.md §5.2d. On the profile row because it is the content's only singleton.
-- Expand-only: a new column with a default, so the previously deployed code, which never
-- selects it, keeps working during a deploy (DESIGN.md §14.4).

ALTER TABLE profile ADD COLUMN content_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Until now every seed rewrote every row, so the profile's updated_at is the last seed: the
-- best answer the database has.
UPDATE profile SET content_updated_at = updated_at;
