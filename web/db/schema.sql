-- photo-hunter game database (MySQL 8)
-- Loaded automatically by the docker-entrypoint-initdb.d hook on first start,
-- and re-applied idempotently by the API server on every boot (server/db.js),
-- so an older volume keeps working after an upgrade.

CREATE TABLE IF NOT EXISTS levels (
  id            INT          NOT NULL,
  slug          VARCHAR(64)  NOT NULL,
  title         VARCHAR(64)  NOT NULL,
  subtitle      VARCHAR(160) NOT NULL,
  era           VARCHAR(32)  NOT NULL,
  image         VARCHAR(64)  NOT NULL,
  image_width   INT          NOT NULL,
  image_height  INT          NOT NULL,
  object_count  INT          NOT NULL,
  sort_order    INT          NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_levels_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The ten anachronisms of each chapter. bbox_* are normalised 0..1 against the
-- full photo, so the same numbers drive the browser and the Android client.
CREATE TABLE IF NOT EXISTS level_objects (
  level_id    INT          NOT NULL,
  object_id   INT          NOT NULL,
  name        VARCHAR(64)  NOT NULL,
  name_en     VARCHAR(96)  NOT NULL,
  reason      VARCHAR(255) NOT NULL,
  hint        VARCHAR(255) NOT NULL,
  bbox_x      FLOAT        NOT NULL,
  bbox_y      FLOAT        NOT NULL,
  bbox_w      FLOAT        NOT NULL,
  bbox_h      FLOAT        NOT NULL,
  confidence  ENUM('high','medium','low') NOT NULL DEFAULT 'high',
  PRIMARY KEY (level_id, object_id),
  CONSTRAINT fk_objects_level FOREIGN KEY (level_id) REFERENCES levels (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS players (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_key     CHAR(36)        NOT NULL,
  nickname       VARCHAR(32)     NOT NULL DEFAULT '無名捕手',
  hints          INT             NOT NULL DEFAULT 0,
  hints_granted  INT             NOT NULL DEFAULT 0,
  hints_spent    INT             NOT NULL DEFAULT 0,
  levels_cleared INT             NOT NULL DEFAULT 0,
  total_ms       BIGINT          NOT NULL DEFAULT 0,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_players_key (player_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per player, per chapter. found_objects is a JSON array of object ids.
CREATE TABLE IF NOT EXISTS level_progress (
  player_id     BIGINT UNSIGNED NOT NULL,
  level_id      INT             NOT NULL,
  completed     TINYINT(1)      NOT NULL DEFAULT 0,
  found_objects JSON            NULL,
  found_count   INT             NOT NULL DEFAULT 0,
  hints_used    INT             NOT NULL DEFAULT 0,
  wrong_taps    INT             NOT NULL DEFAULT 0,
  attempts      INT             NOT NULL DEFAULT 0,
  best_ms       INT             NULL,
  completed_at  DATETIME        NULL,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (player_id, level_id),
  KEY idx_progress_completed (completed),
  CONSTRAINT fk_progress_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE,
  CONSTRAINT fk_progress_level  FOREIGN KEY (level_id)  REFERENCES levels (id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per attempt at a chapter: feeds "best time" and the leaderboard.
-- Millisecond precision matters: a fast chapter takes well under a second, and
-- a plain DATETIME would round every quick clear down to 00:00.
CREATE TABLE IF NOT EXISTS play_sessions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id   BIGINT UNSIGNED NOT NULL,
  level_id    INT             NOT NULL,
  attempt     INT             NOT NULL DEFAULT 1,
  started_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3)     NULL,
  duration_ms INT             NULL,
  hints_used  INT             NOT NULL DEFAULT 0,
  wrong_taps  INT             NOT NULL DEFAULT 0,
  completed   TINYINT(1)      NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_sessions_player (player_id, level_id, started_at),
  CONSTRAINT fk_sessions_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE,
  CONSTRAINT fk_sessions_level  FOREIGN KEY (level_id)  REFERENCES levels (id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit trail for the 锦囊 economy: every award (milestone bonus) ...
CREATE TABLE IF NOT EXISTS hint_grants (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id  BIGINT UNSIGNED NOT NULL,
  amount     INT             NOT NULL,
  milestone  INT             NULL,
  reason     VARCHAR(64)     NOT NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_grants_player (player_id),
  CONSTRAINT fk_grants_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ... and every spend (a hint that auto-found an object or marked its position).
CREATE TABLE IF NOT EXISTS hint_events (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id  BIGINT UNSIGNED NOT NULL,
  level_id   INT             NOT NULL,
  object_id  INT             NOT NULL,
  mode       ENUM('reveal','locate') NOT NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_events_player (player_id),
  CONSTRAINT fk_events_player FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE,
  CONSTRAINT fk_events_level  FOREIGN KEY (level_id)  REFERENCES levels (id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Upgrades for databases created by an earlier version of this schema file.
-- Both statements are idempotent, so a fresh volume and an old one converge.
ALTER TABLE play_sessions
  MODIFY started_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  MODIFY finished_at DATETIME(3) NULL;

-- Leaderboard view: keeps the API query trivial.
CREATE OR REPLACE VIEW leaderboard AS
SELECT p.id                                   AS player_id,
       p.nickname                             AS nickname,
       p.levels_cleared                       AS levels_cleared,
       p.total_ms                             AS total_ms,
       p.hints_spent                          AS hints_spent,
       (SELECT COUNT(*) FROM level_progress lp
         WHERE lp.player_id = p.id AND lp.completed = 1) AS completed_chapters,
       (SELECT COALESCE(SUM(lp.found_count), 0) FROM level_progress lp
         WHERE lp.player_id = p.id)                      AS objects_found,
       (SELECT COALESCE(SUM(lp.wrong_taps), 0) FROM level_progress lp
         WHERE lp.player_id = p.id)                      AS wrong_taps,
       p.last_seen_at                         AS last_seen_at
FROM players p
WHERE p.levels_cleared > 0;
