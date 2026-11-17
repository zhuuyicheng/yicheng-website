-- Education entries shown on the profile (degrees, schools, certifications).
-- Additive only (a new table), so the previously deployed code keeps working.

CREATE TABLE education (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution    TEXT        NOT NULL,                 -- "National University of Singapore (NUS)"
  qualification  TEXT        NOT NULL,                 -- "Bachelor of Computing (Honours) in Computer Science"
  start_date     DATE        NOT NULL,
  end_date       DATE,                                 -- NULL = still studying
  highlights     TEXT[]      NOT NULL DEFAULT '{}',    -- honours, scholarships, grades
  sort_order     INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT education_dates_ordered CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX education_display_order_idx ON education (sort_order, start_date DESC);
