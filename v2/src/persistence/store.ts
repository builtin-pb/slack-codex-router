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

type TableInfoRow = {
  name: string;
};

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (databasePath: string) => DatabaseHandle;

type ThreadRow = ThreadRecord;
type RestartIntentRow = RestartIntent;

export class RouterStore {
  private readonly db: DatabaseHandle;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    this.db = new Database(databasePath);
    this.db.exec(bootstrapSql);
    this.ensureThreadsActiveTurnIdColumn();
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
          state,
          worktree_path,
          branch_name,
          base_branch
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(slack_channel_id, slack_thread_ts) DO UPDATE SET
          slack_channel_id = excluded.slack_channel_id,
          slack_thread_ts = excluded.slack_thread_ts,
          app_server_thread_id = excluded.app_server_thread_id,
          active_turn_id = excluded.active_turn_id,
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
}

function normalizeThreadRow(row: ThreadRow): ThreadRow {
  return {
    ...row,
    activeTurnId: row.activeTurnId ?? null,
  };
}
