CREATE TABLE matches (
  id UUID PRIMARY KEY,
  join_code VARCHAR(12) NOT NULL UNIQUE,
  host_player_id UUID NOT NULL REFERENCES players(id),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'completed')),
  winner_player_id UUID REFERENCES players(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE TABLE swords (
  id UUID PRIMARY KEY,
  owner_player_id UUID NOT NULL REFERENCES players(id),
  device_id VARCHAR(64) NOT NULL UNIQUE,
  label VARCHAR(40) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE match_players (
  match_id UUID NOT NULL REFERENCES matches(id),
  player_id UUID NOT NULL REFERENCES players(id),
  slot SMALLINT NOT NULL CHECK (slot IN (1, 2)),
  sword_id UUID REFERENCES swords(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (match_id, player_id),
  UNIQUE (match_id, slot),
  UNIQUE (match_id, sword_id)
);
CREATE INDEX match_players_player_idx ON match_players (player_id, joined_at DESC);

CREATE TABLE match_events (
  id UUID PRIMARY KEY,
  match_id UUID NOT NULL,
  player_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'match-created', 'player-joined', 'sword-assigned', 'match-started', 'match-finished',
    'button', 'gesture', 'ir-hit'
  )),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (match_id, player_id) REFERENCES match_players(match_id, player_id)
);
CREATE INDEX match_events_match_time_idx ON match_events (match_id, created_at DESC, id DESC);

CREATE TABLE sword_samples (
  id UUID NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  match_id UUID NOT NULL,
  player_id UUID NOT NULL,
  sword_id UUID NOT NULL REFERENCES swords(id),
  readings JSONB NOT NULL,
  PRIMARY KEY (captured_at, id),
  FOREIGN KEY (match_id, player_id) REFERENCES match_players(match_id, player_id)
);
CREATE INDEX sword_samples_match_time_idx ON sword_samples (match_id, player_id, captured_at DESC, id DESC);
CREATE INDEX sword_samples_device_time_idx ON sword_samples (sword_id, captured_at DESC);

CREATE TABLE camera_samples (
  id UUID NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  match_id UUID NOT NULL,
  player_id UUID NOT NULL,
  camera_id VARCHAR(64) NOT NULL,
  uploaded_by_player_id UUID NOT NULL REFERENCES players(id),
  tracking JSONB NOT NULL,
  PRIMARY KEY (captured_at, id),
  FOREIGN KEY (match_id, player_id) REFERENCES match_players(match_id, player_id)
);
CREATE INDEX camera_samples_match_time_idx ON camera_samples (match_id, player_id, captured_at DESC, id DESC);
