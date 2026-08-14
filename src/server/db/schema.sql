-- VaultFront player stats and match history schema
-- Postgres. Apply via: psql $DATABASE_URL -f schema.sql

-- ── Player Stats ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS player_stats (
  persistent_id       VARCHAR(64)  PRIMARY KEY,
  display_name        VARCHAR(64)  NOT NULL DEFAULT '',
  elo_rating          INT          NOT NULL DEFAULT 1200,
  matches_played      INT          NOT NULL DEFAULT 0,
  wins                INT          NOT NULL DEFAULT 0,
  losses              INT          NOT NULL DEFAULT 0,
  vault_captures      INT          NOT NULL DEFAULT 0,
  convoy_deliveries   INT          NOT NULL DEFAULT 0,
  execution_chains    INT          NOT NULL DEFAULT 0,
  surge_activations   INT          NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_stats_elo
  ON player_stats (elo_rating DESC);

-- ── Match History ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_history (
  id                  SERIAL       PRIMARY KEY,
  persistent_id       VARCHAR(64)  NOT NULL REFERENCES player_stats(persistent_id),
  game_id             VARCHAR(64)  NOT NULL,
  won                 BOOLEAN      NOT NULL,
  duration_seconds    INT          NOT NULL DEFAULT 0,
  vault_captures      INT          NOT NULL DEFAULT 0,
  convoy_deliveries   INT          NOT NULL DEFAULT 0,
  execution_chains    INT          NOT NULL DEFAULT 0,
  elo_before          INT          NOT NULL DEFAULT 1200,
  elo_after           INT          NOT NULL DEFAULT 1200,
  elo_delta           INT          NOT NULL DEFAULT 0,
  map_name            VARCHAR(128) NOT NULL DEFAULT '',
  player_count        INT          NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_history_pid_date
  ON match_history (persistent_id, created_at DESC);

-- One certified game may update each participant exactly once. This is both a
-- replay guard after worker restart and the final database backstop behind the
-- in-process progression coalescer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_match_history_player_game
  ON match_history (persistent_id, game_id);
-- ── Certified Match Feedback ────────────────────────────────────────────────
-- The application verifies that the actor participated in the certified match
-- and derives map_name from the archive before writing. The unique key makes
-- retries explicit instead of silently multiplying product feedback.
CREATE TABLE IF NOT EXISTS match_feedback (
  persistent_id VARCHAR(64)  NOT NULL REFERENCES player_stats(persistent_id),
  game_id       VARCHAR(64)  NOT NULL,
  map_name      VARCHAR(128) NOT NULL,
  match_rating  SMALLINT     NOT NULL CHECK (match_rating BETWEEN 1 AND 5),
  map_rating                   SMALLINT     NOT NULL CHECK (map_rating BETWEEN 1 AND 5),
  comment                      VARCHAR(200),
  feedback_won                 BOOLEAN      NOT NULL,
  feedback_behind_at_minute_8  BOOLEAN      NOT NULL,
  feedback_play_style          VARCHAR(32)  NOT NULL CHECK (
    feedback_play_style IN ('Iron Fist', 'Convoy Lord', 'Shadow Broker', 'Fortress', 'Balanced')
  ),
  feedback_style_confidence    SMALLINT     NOT NULL CHECK (feedback_style_confidence BETWEEN 0 AND 100),
  created_at                   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (persistent_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_match_feedback_map_date
  ON match_feedback (map_name, created_at DESC);

-- Existing deployments receive nullable projection columns; all new writes are
-- certificate-derived and complete. Legacy rows remain aggregate-safe.
ALTER TABLE match_feedback
  ADD COLUMN IF NOT EXISTS feedback_won BOOLEAN,
  ADD COLUMN IF NOT EXISTS feedback_behind_at_minute_8 BOOLEAN,
  ADD COLUMN IF NOT EXISTS feedback_play_style VARCHAR(32),
  ADD COLUMN IF NOT EXISTS feedback_style_confidence SMALLINT;

-- ── Certified Outcomes + Career Style ──────────────────────────────────────
-- Win/loss, match duration, behind-at-eight, and play style are projected from
-- the signed server result envelope. Browser observations never write here.
CREATE TABLE IF NOT EXISTS certified_outcomes (
  persistent_id       VARCHAR(64)  NOT NULL REFERENCES player_stats(persistent_id),
  game_id             VARCHAR(64)  NOT NULL,
  won                 BOOLEAN      NOT NULL,
  behind_at_minute_8  BOOLEAN      NOT NULL DEFAULT FALSE,
  duration_seconds    INT          NOT NULL CHECK (duration_seconds >= 0),
  map_name            VARCHAR(128) NOT NULL,
  play_style          VARCHAR(32)  NOT NULL CHECK (
    play_style IN ('Iron Fist', 'Convoy Lord', 'Shadow Broker', 'Fortress', 'Balanced')
  ),
  style_confidence    SMALLINT     NOT NULL CHECK (style_confidence BETWEEN 0 AND 100),
  style_metrics       JSONB        NOT NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (persistent_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_certified_outcomes_player_date
  ON certified_outcomes (persistent_id, created_at DESC);
-- ── Leaderboard Projection ─────────────────────────────────────────────────────
-- player_stats is the sole write authority. Ranked reads select a bounded top-N
-- through this stable Elo + identity order, so certified match transactions never
-- perform table-wide cache work.
CREATE INDEX IF NOT EXISTS idx_player_stats_rank_projection
  ON player_stats (elo_rating DESC, persistent_id ASC)
  INCLUDE (display_name, matches_played, wins)
  WHERE matches_played > 0;

-- Migration-safe legacy surface. Existing deployments may still carry this table;
-- it is deliberately retained but no runtime writer or reader treats it as truth.
CREATE TABLE IF NOT EXISTS leaderboard_cache (
  persistent_id   VARCHAR(64)  PRIMARY KEY,
  display_name    VARCHAR(64)  NOT NULL DEFAULT '',
  elo_rating      INT          NOT NULL DEFAULT 1200,
  rank            INT          NOT NULL DEFAULT 0,
  matches_played  INT          NOT NULL DEFAULT 0,
  wins            INT          NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Player Achievements ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS player_achievements (
  persistent_id   VARCHAR(64)  NOT NULL,
  achievement_id  VARCHAR(64)  NOT NULL,
  unlocked_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (persistent_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_player_achievements_pid
  ON player_achievements (persistent_id);

-- ── Certified/incomplete archive delivery outbox ─────────────────────────────
-- The external archive API is an at-least-once transport. This durable outbox
-- separates result certification from delivery acknowledgement and permits
-- bounded restart-safe retry without treating certificate presence as success.
CREATE TABLE IF NOT EXISTS game_archive_outbox (
  delivery_id     VARCHAR(200) PRIMARY KEY,
  game_id          VARCHAR(64)  NOT NULL,
  delivery_kind    VARCHAR(16)  NOT NULL
                   CHECK (delivery_kind IN ('certified', 'incomplete')),
  certificate_id   VARCHAR(128),
  payload          JSONB        NOT NULL,
  state            VARCHAR(16)  NOT NULL DEFAULT 'queued'
                   CHECK (state IN ('queued', 'delivering', 'delivered', 'dead-letter')),
  attempts         INT          NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  lease_until      TIMESTAMPTZ,
  last_error       VARCHAR(200),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  delivered_at     TIMESTAMPTZ,
  CHECK (
    (delivery_kind = 'certified' AND certificate_id IS NOT NULL)
    OR (delivery_kind = 'incomplete' AND certificate_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_game_archive_outbox_due
  ON game_archive_outbox (state, next_attempt_at)
  WHERE state IN ('queued', 'delivering');

-- ── Season Votes ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS season_votes (
  week_number   INT          NOT NULL,
  voter_id      VARCHAR(128) NOT NULL,
  candidate_key VARCHAR(64)  NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (week_number, voter_id)
);

CREATE TABLE IF NOT EXISTS season_mutator_outcomes (
  effective_week INT          PRIMARY KEY,
  selected_key   VARCHAR(64)  NOT NULL,
  source         VARCHAR(64)  NOT NULL,
  durability     VARCHAR(32)  NOT NULL DEFAULT 'postgres',
  winning_votes  INT          NOT NULL CHECK (winning_votes >= 0),
  total_votes    INT          NOT NULL CHECK (total_votes >= winning_votes),
  decided_at     TIMESTAMPTZ  NOT NULL,
  receipt_digest VARCHAR(80)  NOT NULL
);

CREATE TABLE IF NOT EXISTS match_progression_receipts (
  game_id        VARCHAR(128) PRIMARY KEY,
  actor_ids      TEXT[]       NOT NULL,
  receipt        JSONB        NOT NULL,
  receipt_digest VARCHAR(80)  NOT NULL,
  recorded_at    TIMESTAMPTZ  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_match_progression_receipts_actor_ids
  ON match_progression_receipts USING GIN (actor_ids);

CREATE INDEX IF NOT EXISTS idx_match_progression_receipts_recorded_at
  ON match_progression_receipts (recorded_at);

-- ── Clans ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clans (
  id            VARCHAR(32)  PRIMARY KEY,
  name          VARCHAR(32)  NOT NULL UNIQUE,
  tag           VARCHAR(6)   NOT NULL UNIQUE,
  founder_id    VARCHAR(64)  NOT NULL,
  description   VARCHAR(256) NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clan_members (
  clan_id       VARCHAR(32)  NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  persistent_id VARCHAR(64)  NOT NULL,
  role          VARCHAR(16)  NOT NULL DEFAULT 'member', -- 'founder' | 'officer' | 'member'
  joined_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (clan_id, persistent_id)
);

CREATE INDEX IF NOT EXISTS idx_clan_members_pid
  ON clan_members (persistent_id);

-- ── Tournaments ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournaments (
  id            VARCHAR(32)  PRIMARY KEY,
  name          VARCHAR(64)  NOT NULL,
  map_name      VARCHAR(128) NOT NULL DEFAULT '',
  max_players   INT          NOT NULL DEFAULT 8,
  status        VARCHAR(16)  NOT NULL DEFAULT 'registration', -- 'registration' | 'active' | 'complete'
  created_by    VARCHAR(64)  NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tournament_slots (
  tournament_id VARCHAR(32)  NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  persistent_id VARCHAR(64)  NOT NULL,
  seed          INT          NOT NULL DEFAULT 0,
  elo_at_entry  INT          NOT NULL DEFAULT 1200,
  registered_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tournament_id, persistent_id)
);

CREATE TABLE IF NOT EXISTS tournament_matches (
  id            SERIAL       PRIMARY KEY,
  tournament_id VARCHAR(32)  NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round         INT          NOT NULL,
  match_index   INT          NOT NULL, -- position in the round (0-indexed)
  player_a      VARCHAR(64),
  player_b      VARCHAR(64),
  winner_id     VARCHAR(64),
  game_id       VARCHAR(64),
  result_certificate_id VARCHAR(64),
  status        VARCHAR(16)  NOT NULL DEFAULT 'pending', -- 'pending' | 'active' | 'complete'
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tournament_matches_tid
  ON tournament_matches (tournament_id, round);

ALTER TABLE tournament_matches
  ADD COLUMN IF NOT EXISTS result_certificate_id VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_matches_game_cert
  ON tournament_matches (game_id) WHERE game_id IS NOT NULL;

-- ── Dynasty Mode ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clan_dynasty_chapters (
  clan_id VARCHAR(32) NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  certificate_id VARCHAR(64) NOT NULL,
  chapter VARCHAR(512) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (clan_id, certificate_id)
);
ALTER TABLE player_stats
  ADD COLUMN IF NOT EXISTS dynasty_tier        VARCHAR(16)  NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS dynasty_seasons_won INT          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dynasty_broken_by   VARCHAR(64),
  ADD COLUMN IF NOT EXISTS dynasty_emblem      VARCHAR(64);

-- ── Anti-Cheat Behavioral Signals ─────────────────────────────────────────────
ALTER TABLE match_history
  ADD COLUMN IF NOT EXISTS cmd_mean_interval_ms  FLOAT,
  ADD COLUMN IF NOT EXISTS cmd_stddev_ms         FLOAT,
  ADD COLUMN IF NOT EXISTS cmd_actions_per_tick  FLOAT,
  ADD COLUMN IF NOT EXISTS anti_cheat_flagged    BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_match_history_anticheat
  ON match_history (persistent_id, anti_cheat_flagged)
  WHERE anti_cheat_flagged = TRUE;

-- ── Play Style / Session Insight ───────────────────────────────────────────────
ALTER TABLE match_history
  ADD COLUMN IF NOT EXISTS style_aggression  FLOAT,
  ADD COLUMN IF NOT EXISTS style_economy     FLOAT,
  ADD COLUMN IF NOT EXISTS style_deception   FLOAT,
  ADD COLUMN IF NOT EXISTS style_resilience  FLOAT;

-- ── Clan ELO (Clan Wars) ───────────────────────────────────────────────────────
ALTER TABLE clans
  ADD COLUMN IF NOT EXISTS clan_elo          INT  NOT NULL DEFAULT 1200,
  ADD COLUMN IF NOT EXISTS clan_wins         INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clan_losses       INT  NOT NULL DEFAULT 0;

-- ── Dynasty Story Engine ────────────────────────────────────────────────────────
ALTER TABLE clans
  ADD COLUMN IF NOT EXISTS dynasty_story     TEXT;

-- ── IGNIS Founder Signal Feedback Loop ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ignis_signals (
  id           SERIAL       PRIMARY KEY,
  item_slug    VARCHAR(128) NOT NULL,
  signal       VARCHAR(16)  NOT NULL CHECK (signal IN ('accept', 'reject', 'pivot')),
  session_id   VARCHAR(128),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ignis_signals_slug
  ON ignis_signals (item_slug, created_at DESC);

-- ── Spectator Economy ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spectator_bets (
  id             SERIAL       PRIMARY KEY,
  game_id        VARCHAR(64)  NOT NULL,
  spectator_id   VARCHAR(128) NOT NULL,
  prediction     VARCHAR(256) NOT NULL,
  amount         INT          NOT NULL DEFAULT 0,
  outcome        VARCHAR(16),           -- 'win' | 'loss' | null (unresolved)
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spectator_bets_game
  ON spectator_bets (game_id);
-- ── Certified Daily Mastery ─────────────────────────────────────────────────
-- Only server-certified match envelopes may write these tables. The event key
-- makes one match contribute at most once to one player's UTC-day objective.
CREATE TABLE IF NOT EXISTS daily_mastery_events (
  persistent_id   VARCHAR(64)  NOT NULL,
  challenge_date  DATE         NOT NULL,
  game_id         VARCHAR(64)  NOT NULL,
  challenge_id    VARCHAR(64)  NOT NULL,
  metric          VARCHAR(32)  NOT NULL CHECK (
    metric IN (
      'wins',
      'vault_captures',
      'convoy_deliveries',
      'convoy_intercepts',
      'execution_chains',
      'surge_activations'
    )
  ),
  amount           INT          NOT NULL CHECK (amount >= 0),
  recorded_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (persistent_id, challenge_date, game_id)
);

CREATE TABLE IF NOT EXISTS daily_mastery_progress (
  persistent_id   VARCHAR(64)  NOT NULL,
  challenge_date  DATE         NOT NULL,
  challenge_id    VARCHAR(64)  NOT NULL,
  progress        INT          NOT NULL DEFAULT 0 CHECK (progress >= 0),
  target          INT          NOT NULL CHECK (target > 0),
  reward_mastery  INT          NOT NULL CHECK (reward_mastery >= 0),
  completed_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (persistent_id, challenge_date)
);

CREATE TABLE IF NOT EXISTS daily_mastery_wallet (
  persistent_id   VARCHAR(64)  PRIMARY KEY,
  mastery_balance INT          NOT NULL DEFAULT 0 CHECK (mastery_balance >= 0),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_mastery_doctrine_unlocks (
  persistent_id VARCHAR(64)  NOT NULL,
  doctrine_id   VARCHAR(32)  NOT NULL,
  cost_mastery  INT          NOT NULL CHECK (cost_mastery >= 0),
  unlocked_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (persistent_id, doctrine_id)
);

CREATE TABLE IF NOT EXISTS daily_mastery_doctrine_profiles (
  persistent_id      VARCHAR(64) PRIMARY KEY,
  active_doctrine_id VARCHAR(32) NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A reservation row is written before wallet mutation. Its eventual receipt
-- makes network retries exactly-once and detects request-ID reuse.
CREATE TABLE IF NOT EXISTS daily_mastery_doctrine_requests (
  persistent_id VARCHAR(64)  NOT NULL,
  request_id    VARCHAR(128) NOT NULL,
  doctrine_id   VARCHAR(32)  NOT NULL,
  receipt       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (persistent_id, request_id)
);

-- ── Authenticated Alpha Evidence ─────────────────────────────────────────────
-- Pseudonymous actor keys are server-derived. The 24-hour Alpha gate reads the
-- durable event ledger; event IDs make retries idempotent across worker restarts.
CREATE TABLE IF NOT EXISTS playtest_evidence_sessions (
  evidence_session_id VARCHAR(128) PRIMARY KEY,
  actor_key            VARCHAR(128) NOT NULL,
  first_seen_at        TIMESTAMPTZ  NOT NULL,
  last_seen_at         TIMESTAMPTZ  NOT NULL
);

CREATE TABLE IF NOT EXISTS playtest_evidence_events (
  event_id             VARCHAR(128) PRIMARY KEY,
  evidence_session_id  VARCHAR(128) NOT NULL
    REFERENCES playtest_evidence_sessions(evidence_session_id),
  actor_key            VARCHAR(128) NOT NULL,
  surface              VARCHAR(32)  NOT NULL CHECK (
    surface IN ('tutorial', 'match', 'tournament', 'retention')
  ),
  event_name           VARCHAR(64)  NOT NULL,
  source               VARCHAR(16)  NOT NULL CHECK (source = 'human'),
  occurred_at          TIMESTAMPTZ  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_playtest_evidence_window
  ON playtest_evidence_events (occurred_at DESC);

-- ── Certified Seasonal Contracts ───────────────────────────────────────────
-- The client can only read this state. One certified match result contributes
-- at most once to one player's active season.
CREATE TABLE IF NOT EXISTS season_contract_events (
  persistent_id       VARCHAR(64) NOT NULL,
  season_id           VARCHAR(32) NOT NULL,
  game_id             VARCHAR(64) NOT NULL,
  interception_timing INT NOT NULL DEFAULT 0 CHECK (interception_timing >= 0),
  objective_denial    INT NOT NULL DEFAULT 0 CHECK (objective_denial >= 0),
  comeback_execution  INT NOT NULL DEFAULT 0 CHECK (comeback_execution >= 0),
  surge_execution     INT NOT NULL DEFAULT 0 CHECK (surge_execution >= 0),
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (persistent_id, season_id, game_id)
);

CREATE TABLE IF NOT EXISTS season_contract_progress (
  persistent_id       VARCHAR(64) NOT NULL,
  season_id           VARCHAR(32) NOT NULL,
  interception_timing INT NOT NULL DEFAULT 0 CHECK (interception_timing >= 0),
  objective_denial    INT NOT NULL DEFAULT 0 CHECK (objective_denial >= 0),
  comeback_execution  INT NOT NULL DEFAULT 0 CHECK (comeback_execution >= 0),
  surge_execution     INT NOT NULL DEFAULT 0 CHECK (surge_execution >= 0),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (persistent_id, season_id)
);

-- ── Certified Season Pass ──────────────────────────────────────────────────
-- Progress is accepted once per certified player/season/game result. Claims
-- materialize cosmetic entitlements and survive worker restarts.
CREATE TABLE IF NOT EXISTS season_pass_events (
  persistent_id         VARCHAR(64) NOT NULL,
  season_id             VARCHAR(32) NOT NULL,
  game_id               VARCHAR(64) NOT NULL,
  matches_played        INT NOT NULL DEFAULT 0 CHECK (matches_played >= 0),
  gold_delivered_k      INT NOT NULL DEFAULT 0 CHECK (gold_delivered_k >= 0),
  vault_captures        INT NOT NULL DEFAULT 0 CHECK (vault_captures >= 0),
  convoy_deliveries     INT NOT NULL DEFAULT 0 CHECK (convoy_deliveries >= 0),
  achievements_unlocked INT NOT NULL DEFAULT 0 CHECK (achievements_unlocked >= 0),
  chain_combos          INT NOT NULL DEFAULT 0 CHECK (chain_combos >= 0),
  recorded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (persistent_id, season_id, game_id)
);

CREATE TABLE IF NOT EXISTS season_pass_progress (
  persistent_id         VARCHAR(64) NOT NULL,
  season_id             VARCHAR(32) NOT NULL,
  matches_played        INT NOT NULL DEFAULT 0 CHECK (matches_played >= 0),
  gold_delivered_k      INT NOT NULL DEFAULT 0 CHECK (gold_delivered_k >= 0),
  vault_captures        INT NOT NULL DEFAULT 0 CHECK (vault_captures >= 0),
  convoy_deliveries     INT NOT NULL DEFAULT 0 CHECK (convoy_deliveries >= 0),
  achievements_unlocked INT NOT NULL DEFAULT 0 CHECK (achievements_unlocked >= 0),
  chain_combos          INT NOT NULL DEFAULT 0 CHECK (chain_combos >= 0),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (persistent_id, season_id)
);

CREATE TABLE IF NOT EXISTS season_pass_entitlements (
  persistent_id VARCHAR(64) NOT NULL,
  season_id     VARCHAR(32) NOT NULL,
  milestone_id VARCHAR(16) NOT NULL,
  reward_type   VARCHAR(16) NOT NULL CHECK (reward_type IN ('title', 'badge')),
  reward_value  VARCHAR(96) NOT NULL,
  claimed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (persistent_id, season_id, milestone_id)
);

CREATE INDEX IF NOT EXISTS idx_season_pass_entitlements_player
  ON season_pass_entitlements (persistent_id, claimed_at DESC);

-- ── Certified Core-Loop Evidence ───────────────────────────────────────────
-- One privacy-minimal aggregate per certified game. No player identity or
-- browser-authored telemetry is stored here.
CREATE TABLE IF NOT EXISTS certified_loop_evidence (
  game_id                       VARCHAR(64) PRIMARY KEY,
  duration_seconds              INT NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  player_samples                INT NOT NULL DEFAULT 0 CHECK (player_samples >= 0),
  vault_participants            INT NOT NULL DEFAULT 0 CHECK (vault_participants >= 0),
  outcome_participants          INT NOT NULL DEFAULT 0 CHECK (outcome_participants >= 0),
  completed_cycle_participants  INT NOT NULL DEFAULT 0 CHECK (completed_cycle_participants >= 0),
  certified_loop_participants   INT NOT NULL DEFAULT 0 CHECK (certified_loop_participants >= 0),
  first_vault_seconds_total     DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (first_vault_seconds_total >= 0),
  first_vault_samples           INT NOT NULL DEFAULT 0 CHECK (first_vault_samples >= 0),
  first_outcome_seconds_total   DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (first_outcome_seconds_total >= 0),
  first_outcome_samples         INT NOT NULL DEFAULT 0 CHECK (first_outcome_samples >= 0),
  pressure_breach_funnel        JSONB NOT NULL DEFAULT '{}',
  intent_funnel                 JSONB NOT NULL DEFAULT '{"early":{},"mid":{},"late":{}}'::jsonb,
  recorded_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent live migration for databases created before the certified
-- Pressure → Breach → decisive-delivery/victory funnel was introduced.
ALTER TABLE certified_loop_evidence
  ADD COLUMN IF NOT EXISTS pressure_breach_funnel JSONB NOT NULL DEFAULT '{}';

ALTER TABLE certified_loop_evidence
  ADD COLUMN IF NOT EXISTS certified_loop_participants INT NOT NULL DEFAULT 0
  CHECK (certified_loop_participants >= 0);

CREATE INDEX IF NOT EXISTS idx_certified_loop_evidence_recorded
  ON certified_loop_evidence (recorded_at DESC);

-- ── Spectator Prediction League ────────────────────────────────────────────
-- The game tombstone closes submissions permanently before resolution. Both
-- submission and resolution take the same PostgreSQL advisory transaction lock.
CREATE TABLE IF NOT EXISTS prediction_league_games (
  game_id         VARCHAR(64) PRIMARY KEY,
  actual_outcome  VARCHAR(16) NOT NULL CHECK (actual_outcome IN ('intercept', 'delivery')),
  resolved_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prediction_league_predictions (
  game_id            VARCHAR(64) NOT NULL,
  spectator_id       VARCHAR(64) NOT NULL,
  predicted_outcome  VARCHAR(16) NOT NULL CHECK (predicted_outcome IN ('intercept', 'delivery')),
  submitted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  week_key           VARCHAR(8) NOT NULL,
  actual_outcome     VARCHAR(16) CHECK (actual_outcome IN ('intercept', 'delivery')),
  correct            BOOLEAN,
  resolved_at        TIMESTAMPTZ,
  PRIMARY KEY (game_id, spectator_id)
);

CREATE INDEX IF NOT EXISTS idx_prediction_league_spectator_resolved
  ON prediction_league_predictions (spectator_id, resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_prediction_league_week_resolved
  ON prediction_league_predictions (week_key, resolved_at DESC)
  WHERE resolved_at IS NOT NULL;

-- ── Fortune Deck (S99 audit #180) ───────────────────────────────────────────
-- FortuneDeck.draw() has always attempted this INSERT, but the table was
-- never created -- every Postgres-mode draw silently failed to persist
-- (caught and logged, never surfaced). This closes the write path and adds
-- the read path (fortune-collection endpoint) plus an equip slot.
CREATE TABLE IF NOT EXISTS player_fortune (
  persistent_id VARCHAR(64)  NOT NULL REFERENCES player_stats(persistent_id),
  match_id      VARCHAR(64)  NOT NULL,
  item_id       VARCHAR(64)  NOT NULL,
  rarity        VARCHAR(16)  NOT NULL CHECK (rarity IN ('common', 'rare', 'legendary')),
  item_name     VARCHAR(64)  NOT NULL,
  drawn_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (persistent_id, match_id)
);

CREATE INDEX IF NOT EXISTS idx_player_fortune_persistent
  ON player_fortune (persistent_id, drawn_at DESC);

ALTER TABLE player_stats
  ADD COLUMN IF NOT EXISTS equipped_fortune_title VARCHAR(64);

-- ── Signed Replay Manifests ────────────────────────────────────────────────
-- Shared across workers so replay URLs and verification survive restarts.
CREATE TABLE IF NOT EXISTS replay_manifests (
  game_id     VARCHAR(64) PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL,
  manifest    JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_replay_manifests_started
  ON replay_manifests (started_at DESC);

-- One atomic shared reservation row per UTC hour. The ON CONFLICT update in
-- RemoteAiPolicy enforces the configured cap across every worker.
CREATE TABLE IF NOT EXISTS remote_ai_hourly_usage (
  window_key  BIGINT PRIMARY KEY,
  calls       INT NOT NULL CHECK (calls >= 0),
  by_feature  JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supporter_payment_receipts (
    event_id       TEXT PRIMARY KEY,
    session_id     TEXT NOT NULL,
    amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
    currency       TEXT NOT NULL,
    live_mode      BOOLEAN NOT NULL,
    observed_at    TIMESTAMPTZ NOT NULL,
    receipt_digest TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS supporter_payment_receipts_live_observed_idx
    ON supporter_payment_receipts (live_mode, observed_at DESC);
