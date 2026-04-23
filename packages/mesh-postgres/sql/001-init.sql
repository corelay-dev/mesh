-- Corelay Mesh — Postgres schema v0.0.1
--
-- Apply manually for Week 1. A migration tool ships later.
--
-- Three tables:
--   workflows        — one row per durable run
--   workflow_events  — append-only event log per workflow
--   inbox_messages   — durable per-peer message queue
--
-- All timestamps are stored as BIGINT epoch millis for portability and
-- simple ordering — no timezone nonsense.

CREATE TABLE IF NOT EXISTS workflows (
  id          TEXT        PRIMARY KEY,
  root_peer   TEXT        NOT NULL,
  status      TEXT        NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at  BIGINT      NOT NULL,
  updated_at  BIGINT      NOT NULL,
  error       TEXT
);

CREATE INDEX IF NOT EXISTS workflows_status_updated_idx ON workflows (status, updated_at);

CREATE TABLE IF NOT EXISTS workflow_events (
  id            TEXT        PRIMARY KEY,
  workflow_id   TEXT        NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  kind          TEXT        NOT NULL,
  at            BIGINT      NOT NULL,
  data          JSONB       NOT NULL
);

CREATE INDEX IF NOT EXISTS workflow_events_workflow_idx ON workflow_events (workflow_id, at);

CREATE TABLE IF NOT EXISTS inbox_messages (
  id            TEXT        PRIMARY KEY,
  peer_address  TEXT        NOT NULL,
  payload       JSONB       NOT NULL,
  created_at    BIGINT      NOT NULL,
  consumed_at   BIGINT
);

CREATE INDEX IF NOT EXISTS inbox_messages_peer_unclaimed_idx
  ON inbox_messages (peer_address, created_at)
  WHERE consumed_at IS NULL;
