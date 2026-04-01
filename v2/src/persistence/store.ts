import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { RestartIntent, ThreadRecord } from "../domain/types.js";
import { bootstrapSql } from "./schema.js";

type Statement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};

type DatabaseHandle = {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
};

type StatementRunResult = {
  lastInsertRowid?: number | bigint;
  changes?: number;
};

type TableInfoRow = {
  name: string;
};

type PersistedThreadRow = Omit<ThreadRecord, "appServerSessionStale"> & {
  appServerSessionStale?: number | null;
};

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (databasePath: string) => DatabaseHandle;

type ThreadRow = PersistedThreadRow;
type RestartIntentRow = RestartIntent;
type ChoicePromptPayload = {
  promptId: number;
  options: string[];
};
type MergePreviewPayload = {
  promptId: number;
  sourceBranch: string;
  targetBranch: string;
};
type ChoicePromptRow = {
  promptId: number;
  promptPayloadJson: string;
};
type MergePreviewRow = ChoicePromptRow;

export class RouterStore {
  private readonly db: DatabaseHandle;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    this.db = new Database(databasePath);
    this.db.exec(bootstrapSql);
    this.ensureThreadsActiveTurnIdColumn();
    this.ensureThreadsSessionStaleColumn();
  }

  upsertThread(record: ThreadRecord): void {
    this.db
      .prepare(
        `
        INSERT INTO threads (
          slack_channel_id,
          slack_thread_ts,
          app_server_thread_id,
          active_turn_id,
          app_server_session_stale,
          state,
          worktree_path,
          branch_name,
          base_branch
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(slack_channel_id, slack_thread_ts) DO UPDATE SET
          slack_channel_id = excluded.slack_channel_id,
          slack_thread_ts = excluded.slack_thread_ts,
          app_server_thread_id = excluded.app_server_thread_id,
          active_turn_id = excluded.active_turn_id,
          app_server_session_stale = excluded.app_server_session_stale,
          state = excluded.state,
          worktree_path = excluded.worktree_path,
          branch_name = excluded.branch_name,
          base_branch = excluded.base_branch
      `,
      )
      .run(
        record.slackChannelId,
        record.slackThreadTs,
        record.appServerThreadId,
        record.activeTurnId ?? null,
        record.appServerSessionStale ? 1 : 0,
        record.state,
        record.worktreePath,
        record.branchName,
        record.baseBranch,
      );
  }

  getThread(
    slackChannelId: string,
    slackThreadTs: string,
  ): ThreadRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT
          slack_channel_id AS slackChannelId,
          slack_thread_ts AS slackThreadTs,
          app_server_thread_id AS appServerThreadId,
          active_turn_id AS activeTurnId,
          app_server_session_stale AS appServerSessionStale,
          state,
          worktree_path AS worktreePath,
          branch_name AS branchName,
          base_branch AS baseBranch
        FROM threads
        WHERE slack_channel_id = ? AND slack_thread_ts = ?
      `,
      )
      .get(slackChannelId, slackThreadTs) as ThreadRow | undefined;

    return row ? normalizeThreadRow(row) : null;
  }

  listRecoverableThreads(): ThreadRecord[] {
    return this.db
      .prepare(
        `
        SELECT
          slack_channel_id AS slackChannelId,
          slack_thread_ts AS slackThreadTs,
          app_server_thread_id AS appServerThreadId,
          active_turn_id AS activeTurnId,
          app_server_session_stale AS appServerSessionStale,
          state,
          worktree_path AS worktreePath,
          branch_name AS branchName,
          base_branch AS baseBranch
        FROM threads
        WHERE state != 'failed_setup'
        ORDER BY slack_channel_id ASC, slack_thread_ts ASC
      `,
      )
      .all()
      .map((row) => normalizeThreadRow(row as ThreadRow));
  }

  recordRestartIntent(intent: RestartIntent): void {
    this.db
      .prepare(
        `
        INSERT INTO restart_intents (
          id,
          slack_channel_id,
          slack_thread_ts,
          requested_at
        ) VALUES (1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          slack_channel_id = excluded.slack_channel_id,
          slack_thread_ts = excluded.slack_thread_ts,
          requested_at = excluded.requested_at
      `,
      )
      .run(intent.slackChannelId, intent.slackThreadTs, intent.requestedAt);
  }

  getPendingRestartIntent(): RestartIntent | null {
    const row = this.db
      .prepare(
        `
        SELECT
          slack_channel_id AS slackChannelId,
          slack_thread_ts AS slackThreadTs,
          requested_at AS requestedAt
        FROM restart_intents
        WHERE id = 1
      `,
      )
      .get() as RestartIntentRow | undefined;

    return row ?? null;
  }

  clearRestartIntent(): void {
    this.db.prepare("DELETE FROM restart_intents WHERE id = 1").run();
  }

  clearRestartIntentIfMatches(intent: RestartIntent | null): boolean {
    if (!intent) {
      return false;
    }

    const result = this.db
      .prepare(
        `
        DELETE FROM restart_intents
        WHERE id = 1
          AND slack_channel_id = ?
          AND slack_thread_ts = ?
          AND requested_at = ?
      `,
      )
      .run(intent.slackChannelId, intent.slackThreadTs, intent.requestedAt) as StatementRunResult;

    return (result.changes ?? 0) > 0;
  }

  recordChoicePrompt(input: {
    slackChannelId: string;
    slackThreadTs: string;
    options: string[];
  }): number | null {
    const options = normalizeChoiceOptions(input.options);
    if (options.length === 0) {
      return null;
    }

    const result = this.db
      .prepare(
        `
        INSERT INTO interactive_prompts (
          slack_channel_id,
          slack_thread_ts,
          prompt_kind,
          prompt_payload_json
        ) VALUES (?, ?, 'choice', ?)
      `,
      )
      .run(
        input.slackChannelId,
        input.slackThreadTs,
        JSON.stringify({ options }),
      ) as StatementRunResult;

    const promptId = normalizePromptId(result.lastInsertRowid);
    return promptId;
  }

  getLatestChoicePrompt(
    slackChannelId: string,
    slackThreadTs: string,
  ): ChoicePromptPayload | null {
    const row = this.db
      .prepare(
        `
        SELECT
          prompt_id AS promptId,
          prompt_payload_json AS promptPayloadJson
        FROM interactive_prompts
        WHERE slack_channel_id = ?
          AND slack_thread_ts = ?
          AND prompt_kind = 'choice'
          AND resolved_at IS NULL
        ORDER BY prompt_id DESC
        LIMIT 1
      `,
      )
      .get(slackChannelId, slackThreadTs) as ChoicePromptRow | undefined;

    if (!row) {
      return null;
    }

    return parseChoicePromptPayload(row.promptId, row.promptPayloadJson);
  }

  resolveChoicePrompts(slackChannelId: string, slackThreadTs: string): void {
    this.db
      .prepare(
        `
        UPDATE interactive_prompts
        SET resolved_at = CURRENT_TIMESTAMP
        WHERE slack_channel_id = ?
          AND slack_thread_ts = ?
          AND prompt_kind = 'choice'
          AND resolved_at IS NULL
      `,
      )
      .run(slackChannelId, slackThreadTs);
  }

  discardChoicePrompt(promptId: number): void {
    if (!Number.isInteger(promptId) || promptId <= 0) {
      return;
    }

    this.db
      .prepare(
        `
        DELETE FROM interactive_prompts
        WHERE prompt_id = ?
          AND prompt_kind = 'choice'
          AND resolved_at IS NULL
      `,
      )
      .run(promptId);
  }

  recordMergePreview(input: {
    slackChannelId: string;
    slackThreadTs: string;
    sourceBranch: string;
    targetBranch: string;
  }): number | null {
    const sourceBranch = input.sourceBranch.trim();
    const targetBranch = input.targetBranch.trim();
    if (!sourceBranch || !targetBranch) {
      return null;
    }

    const result = this.db
      .prepare(
        `
        INSERT INTO interactive_prompts (
          slack_channel_id,
          slack_thread_ts,
          prompt_kind,
          prompt_payload_json
        ) VALUES (?, ?, 'merge_preview', ?)
      `,
      )
      .run(
        input.slackChannelId,
        input.slackThreadTs,
        JSON.stringify({ sourceBranch, targetBranch }),
      ) as StatementRunResult;

    return normalizePromptId(result.lastInsertRowid);
  }

  getLatestMergePreview(
    slackChannelId: string,
    slackThreadTs: string,
  ): MergePreviewPayload | null {
    const row = this.db
      .prepare(
        `
        SELECT
          prompt_id AS promptId,
          prompt_payload_json AS promptPayloadJson
        FROM interactive_prompts
        WHERE slack_channel_id = ?
          AND slack_thread_ts = ?
          AND prompt_kind = 'merge_preview'
          AND resolved_at IS NULL
        ORDER BY prompt_id DESC
        LIMIT 1
      `,
      )
      .get(slackChannelId, slackThreadTs) as MergePreviewRow | undefined;

    if (!row) {
      return null;
    }

    return parseMergePreviewPayload(row.promptId, row.promptPayloadJson);
  }

  resolveMergePreviews(slackChannelId: string, slackThreadTs: string): void {
    this.db
      .prepare(
        `
        UPDATE interactive_prompts
        SET resolved_at = CURRENT_TIMESTAMP
        WHERE slack_channel_id = ?
          AND slack_thread_ts = ?
          AND prompt_kind = 'merge_preview'
          AND resolved_at IS NULL
      `,
      )
      .run(slackChannelId, slackThreadTs);
  }

  close(): void {
    this.db.close();
  }

  private ensureThreadsActiveTurnIdColumn(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(threads)")
      .all() as TableInfoRow[];

    if (columns.some((column) => column.name === "active_turn_id")) {
      return;
    }

    this.db.exec("ALTER TABLE threads ADD COLUMN active_turn_id TEXT;");
  }

  private ensureThreadsSessionStaleColumn(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(threads)")
      .all() as TableInfoRow[];

    if (columns.some((column) => column.name === "app_server_session_stale")) {
      return;
    }

    this.db.exec(
      "ALTER TABLE threads ADD COLUMN app_server_session_stale INTEGER NOT NULL DEFAULT 0;",
    );
  }
}

function normalizeThreadRow(row: ThreadRow): ThreadRecord {
  return {
    ...row,
    activeTurnId: row.activeTurnId ?? null,
    appServerSessionStale: Boolean(row.appServerSessionStale),
  };
}

function normalizeChoiceOptions(options: string[]): string[] {
  return options.map((option) => option.trim()).filter((option) => option.length > 0);
}

function normalizePromptId(value: number | bigint | undefined): number | null {
  if (typeof value === "bigint") {
    return Number(value);
  }

  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function parseChoicePromptPayload(
  promptIdValue: number,
  payloadJson: string,
): ChoicePromptPayload | null {
  try {
    const parsed = JSON.parse(payloadJson) as { options?: unknown };
    if (!Array.isArray(parsed.options)) {
      return null;
    }

    const options = normalizeChoiceOptions(
      parsed.options.filter((option): option is string => typeof option === "string"),
    );

    const promptId = normalizePromptId(promptIdValue);
    return options.length > 0 && promptId ? { promptId, options } : null;
  } catch {
    return null;
  }
}

function parseMergePreviewPayload(
  promptIdValue: number,
  payloadJson: string,
): MergePreviewPayload | null {
  try {
    const parsed = JSON.parse(payloadJson) as {
      sourceBranch?: unknown;
      targetBranch?: unknown;
    };
    const promptId = normalizePromptId(promptIdValue);
    const sourceBranch =
      typeof parsed.sourceBranch === "string" ? parsed.sourceBranch.trim() : "";
    const targetBranch =
      typeof parsed.targetBranch === "string" ? parsed.targetBranch.trim() : "";

    return promptId && sourceBranch && targetBranch
      ? { promptId, sourceBranch, targetBranch }
      : null;
  } catch {
    return null;
  }
}
