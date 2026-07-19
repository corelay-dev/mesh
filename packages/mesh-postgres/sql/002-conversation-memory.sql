-- Corelay Mesh — Postgres conversation memory schema
--
-- Durable per-session conversation history.
-- Used by PostgresConversationMemory from @corelay/mesh-postgres.

CREATE TABLE IF NOT EXISTS conversation_messages (
  seq           BIGSERIAL   PRIMARY KEY,
  session_id    TEXT        NOT NULL,
  role          TEXT        NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content       TEXT        NOT NULL,
  tool_call_id  TEXT,
  tool_calls    JSONB,
  created_at    BIGINT      NOT NULL
);

CREATE INDEX IF NOT EXISTS conversation_messages_session_idx
  ON conversation_messages (session_id, seq DESC);
