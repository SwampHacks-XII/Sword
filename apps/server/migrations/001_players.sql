-- First schema only. Safe to rerun; later schema changes need new migrations.
CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY,
  auth0_sub VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(40) NOT NULL CHECK (display_name <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
