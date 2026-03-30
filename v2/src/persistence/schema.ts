import { threadStates } from "../domain/types.js";

const threadStateCheck = threadStates.map((state) => `'${state}'`).join(", ");

export const bootstrapSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS threads (
  slack_channel_id TEXT NOT NULL,
  slack_thread_ts TEXT NOT NULL,
  app_server_thread_id TEXT NOT NULL,
  active_turn_id TEXT,
  app_server_session_stale INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL CHECK (state IN (${threadStateCheck})),
  worktree_path TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  PRIMARY KEY (slack_channel_id, slack_thread_ts)
);

CREATE TABLE IF NOT EXISTS slack_messages (
  slack_message_ts TEXT PRIMARY KEY,
  slack_channel_id TEXT NOT NULL,
  slack_thread_ts TEXT NOT NULL,
  message_text TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (slack_channel_id, slack_thread_ts)
    REFERENCES threads(slack_channel_id, slack_thread_ts)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS interactive_prompts (
  prompt_id INTEGER PRIMARY KEY AUTOINCREMENT,
  slack_channel_id TEXT NOT NULL,
  slack_thread_ts TEXT NOT NULL,
  prompt_kind TEXT NOT NULL,
  prompt_payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  FOREIGN KEY (slack_channel_id, slack_thread_ts)
    REFERENCES threads(slack_channel_id, slack_thread_ts)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS restart_intents (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  slack_channel_id TEXT NOT NULL,
  slack_thread_ts TEXT NOT NULL,
  requested_at TEXT NOT NULL
);
`;
