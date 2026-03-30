import { createRequire } from "node:module";
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
};

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (databasePath: string) => DatabaseHandle;

type ThreadRow = ThreadRecord;
type RestartIntentRow = RestartIntent;

export class RouterStore {
  private readonly db: DatabaseHandle;

  constructor(databasePath: string) {
    this.db = new Database(databasePath);
    this.db.exec(bootstrapSql);
  }

  upsertThread(record: ThreadRecord): void {
    this.db
      .prepare(
        `
        INSERT INTO threads (
          slack_thread_ts,
          slack_channel_id,
          app_server_thread_id,
          state,
          worktree_path,
          branch_name,
          base_branch
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(slack_thread_ts) DO UPDATE SET
          slack_channel_id = excluded.slack_channel_id,
          app_server_thread_id = excluded.app_server_thread_id,
          state = excluded.state,
          worktree_path = excluded.worktree_path,
          branch_name = excluded.branch_name,
          base_branch = excluded.base_branch
      `,
      )
      .run(
        record.slackThreadTs,
        record.slackChannelId,
        record.appServerThreadId,
        record.state,
        record.worktreePath,
        record.branchName,
        record.baseBranch,
      );
  }

  getThread(slackThreadTs: string): ThreadRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT
          slack_channel_id AS slackChannelId,
          slack_thread_ts AS slackThreadTs,
          app_server_thread_id AS appServerThreadId,
          state,
          worktree_path AS worktreePath,
          branch_name AS branchName,
          base_branch AS baseBranch
        FROM threads
        WHERE slack_thread_ts = ?
      `,
      )
      .get(slackThreadTs) as ThreadRow | undefined;

    return row ?? null;
  }

  listRecoverableThreads(): ThreadRecord[] {
    return this.db
      .prepare(
        `
        SELECT
          slack_channel_id AS slackChannelId,
          slack_thread_ts AS slackThreadTs,
          app_server_thread_id AS appServerThreadId,
          state,
          worktree_path AS worktreePath,
          branch_name AS branchName,
          base_branch AS baseBranch
        FROM threads
        WHERE state != 'failed_setup'
        ORDER BY slack_thread_ts ASC
      `,
      )
      .all() as ThreadRow[];
  }

  recordRestartIntent(intent: RestartIntent): void {
    this.db
      .prepare(
        `
        INSERT INTO restart_intents (
          id,
          requested_by_thread_ts,
          requested_at
        ) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          requested_by_thread_ts = excluded.requested_by_thread_ts,
          requested_at = excluded.requested_at
      `,
      )
      .run(intent.requestedByThreadTs, intent.requestedAt);
  }

  getPendingRestartIntent(): RestartIntent | null {
    const row = this.db
      .prepare(
        `
        SELECT
          requested_by_thread_ts AS requestedByThreadTs,
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
}
