-- Preserve every existing match and measurement. Closed rooms can release their
-- short code while completed rounds in an open room remain available for rematches.
ALTER TABLE matches ADD COLUMN room_open BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE matches ADD COLUMN round_number INTEGER NOT NULL DEFAULT 1 CHECK (round_number >= 1);
UPDATE matches SET room_open = FALSE WHERE status = 'completed';
ALTER TABLE matches DROP CONSTRAINT matches_join_code_key;
CREATE UNIQUE INDEX matches_open_code_idx ON matches (join_code) WHERE room_open = TRUE;

CREATE TABLE match_rounds (
  match_id UUID NOT NULL REFERENCES matches(id),
  round_number INTEGER NOT NULL CHECK (round_number >= 1),
  winner_player_id UUID REFERENCES players(id),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (match_id, round_number)
);
INSERT INTO match_rounds (match_id, round_number, winner_player_id, started_at, finished_at)
  SELECT id, 1, winner_player_id, started_at, finished_at FROM matches
  WHERE status = 'completed' AND started_at IS NOT NULL AND finished_at IS NOT NULL;
