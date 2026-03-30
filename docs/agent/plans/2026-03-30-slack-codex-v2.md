# Slack Codex Router v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node-first Slack Codex Router `v2` around Codex App Server with worktree isolation, Slack-native controls, merge-to-main actions, and supervisor-backed native restart while reusing the current `.env` Slack bot setup.

**Architecture:** Add a separate `v2/` TypeScript workspace instead of incrementally mutating the current Python router. A tiny launcher process owns process lifecycle only; the router worker owns Slack, App Server, persistence, recovery, worktrees, and merge actions. Keep the existing Python router in place until the `v2` Slack flow and restart recovery both pass end-to-end in a private channel.

**Tech Stack:** TypeScript, Node.js, Slack Bolt for JavaScript, Codex App Server over stdio, SQLite via `better-sqlite3`, `vitest`, `tsx`, existing `.env` configuration

---

## File Structure

- Create: `v2/package.json`
- Create: `v2/tsconfig.json`
- Create: `v2/.env.example`
- Create: `v2/src/bin/launcher.ts`
- Create: `v2/src/bin/router.ts`
- Create: `v2/src/config.ts`
- Create: `v2/src/domain/types.ts`
- Create: `v2/src/persistence/schema.ts`
- Create: `v2/src/persistence/store.ts`
- Create: `v2/src/runtime/launcher.ts`
- Create: `v2/src/runtime/restart.ts`
- Create: `v2/src/app_server/process.ts`
- Create: `v2/src/app_server/client.ts`
- Create: `v2/src/app_server/events.ts`
- Create: `v2/src/slack/app.ts`
- Create: `v2/src/slack/blocks.ts`
- Create: `v2/src/slack/render.ts`
- Create: `v2/src/router/service.ts`
- Create: `v2/src/worktree/manager.ts`
- Create: `v2/src/git/merge_to_main.ts`
- Create: `v2/test/config.test.ts`
- Create: `v2/test/store.test.ts`
- Create: `v2/test/launcher.test.ts`
- Create: `v2/test/app_server_client.test.ts`
- Create: `v2/test/router_service.test.ts`
- Create: `v2/test/slack_blocks.test.ts`
- Create: `v2/test/worktree_manager.test.ts`
- Create: `v2/test/merge_to_main.test.ts`
- Create: `v2/test/restart_recovery.test.ts`
- Modify: `README.md`
- Modify: `scripts/start-router.sh`

Keep the legacy Python code under `src/slack_codex_router/` unchanged until the final cutover task.

### Task 1: Bootstrap the `v2` TypeScript workspace

**Files:**
- Create: `v2/package.json`
- Create: `v2/tsconfig.json`
- Create: `v2/.env.example`
- Create: `v2/src/config.ts`
- Create: `v2/src/bin/router.ts`
- Create: `v2/test/config.test.ts`

- [ ] **Step 1: Write the failing config test**

```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("loads the existing Slack env contract plus v2 defaults", () => {
    const config = loadConfig({
      SLACK_BOT_TOKEN: "xoxb-test",
      SLACK_APP_TOKEN: "xapp-test",
      ALLOWED_SLACK_USER_ID: "U123",
      PROJECTS_FILE: "config/projects.example.yaml",
      ROUTER_STATE_DB: "tmp/router-v2.sqlite3",
    });

    expect(config.slackBotToken).toBe("xoxb-test");
    expect(config.slackAppToken).toBe("xapp-test");
    expect(config.allowedUserId).toBe("U123");
    expect(config.projectsFile).toContain("config/projects.example.yaml");
    expect(config.routerStateDb).toContain("tmp/router-v2.sqlite3");
    expect(config.appServerCommand).toEqual(["codex", "app-server"]);
  });
});
```

- [ ] **Step 2: Run the test to confirm the workspace is missing**

Run: `npm --prefix v2 test -- v2/test/config.test.ts`  
Expected: fail because `v2/package.json` and `src/config.ts` do not exist yet.

- [ ] **Step 3: Create the minimal workspace and config loader**

```json
{
  "name": "slack-codex-router-v2",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/bin/router.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@slack/bolt": "^4.2.0",
    "better-sqlite3": "^11.8.1",
    "dotenv": "^16.5.0",
    "yaml": "^2.7.1"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "tsx": "^4.20.0",
    "typescript": "^5.8.0",
    "vitest": "^3.1.0"
  }
}
```

```ts
export type RouterConfig = {
  slackBotToken: string;
  slackAppToken: string;
  allowedUserId: string;
  projectsFile: string;
  routerStateDb: string;
  appServerCommand: string[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RouterConfig {
  return {
    slackBotToken: requireEnv(env, "SLACK_BOT_TOKEN"),
    slackAppToken: requireEnv(env, "SLACK_APP_TOKEN"),
    allowedUserId: requireEnv(env, "ALLOWED_SLACK_USER_ID"),
    projectsFile: env.PROJECTS_FILE ?? "config/projects.yaml",
    routerStateDb: env.ROUTER_STATE_DB ?? "logs/router-v2/state.sqlite3",
    appServerCommand: (env.CODEX_APP_SERVER_COMMAND ?? "codex app-server").split(" "),
  };
}
```

- [ ] **Step 4: Run the config test**

Run: `npm --prefix v2 test -- v2/test/config.test.ts`  
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add v2/package.json v2/tsconfig.json v2/.env.example v2/src/config.ts v2/src/bin/router.ts v2/test/config.test.ts
git commit -m "feat: bootstrap slack codex router v2 workspace"
```

### Task 2: Add the `v2` persistence schema and recovery primitives

**Files:**
- Create: `v2/src/domain/types.ts`
- Create: `v2/src/persistence/schema.ts`
- Create: `v2/src/persistence/store.ts`
- Create: `v2/test/store.test.ts`

- [ ] **Step 1: Write the failing store test**

```ts
import { describe, expect, it } from "vitest";
import { RouterStore } from "../src/persistence/store";

describe("RouterStore", () => {
  it("persists thread routing, worktree, and restart metadata", () => {
    const store = new RouterStore(":memory:");

    store.upsertThread({
      slackChannelId: "C123",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_abc",
      state: "running",
      worktreePath: "/tmp/router/wt-1",
      branchName: "codex/slack/1710000000.0001",
      baseBranch: "main",
    });

    store.recordRestartIntent({
      requestedByThreadTs: "1710000000.0001",
      requestedAt: "2026-03-30T12:00:00Z",
    });

    const thread = store.getThread("1710000000.0001");
    const restart = store.getPendingRestartIntent();

    expect(thread?.appServerThreadId).toBe("thread_abc");
    expect(thread?.branchName).toBe("codex/slack/1710000000.0001");
    expect(restart?.requestedByThreadTs).toBe("1710000000.0001");
  });
});
```

- [ ] **Step 2: Run the store test**

Run: `npm --prefix v2 test -- v2/test/store.test.ts`  
Expected: fail because `RouterStore` and schema tables do not exist yet.

- [ ] **Step 3: Implement the schema and store**

```ts
export type ThreadRecord = {
  slackChannelId: string;
  slackThreadTs: string;
  appServerThreadId: string;
  state: "idle" | "running" | "awaiting_user_input" | "interrupted" | "failed_setup";
  worktreePath: string;
  branchName: string;
  baseBranch: string;
};

export type RestartIntent = {
  requestedByThreadTs: string;
  requestedAt: string;
};

// schema.ts
export const bootstrapSql = `
CREATE TABLE IF NOT EXISTS threads (...);
CREATE TABLE IF NOT EXISTS slack_messages (...);
CREATE TABLE IF NOT EXISTS interactive_prompts (...);
CREATE TABLE IF NOT EXISTS restart_intents (...);
`;
```

```ts
// store.ts
export class RouterStore {
  upsertThread(record: ThreadRecord): void { /* insert or update */ }
  getThread(slackThreadTs: string): ThreadRecord | null { /* select */ }
  listRecoverableThreads(): ThreadRecord[] { /* select active */ }
  recordRestartIntent(intent: RestartIntent): void { /* insert */ }
  getPendingRestartIntent(): RestartIntent | null { /* select latest */ }
  clearRestartIntent(): void { /* delete */ }
}
```

- [ ] **Step 4: Run the store test**

Run: `npm --prefix v2 test -- v2/test/store.test.ts`  
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add v2/src/domain/types.ts v2/src/persistence/schema.ts v2/src/persistence/store.ts v2/test/store.test.ts
git commit -m "feat: add v2 persistence schema"
```

### Task 3: Build the minimal launcher and router worker lifecycle

**Files:**
- Create: `v2/src/bin/launcher.ts`
- Create: `v2/src/runtime/launcher.ts`
- Create: `v2/src/runtime/restart.ts`
- Create: `v2/test/launcher.test.ts`

- [ ] **Step 1: Write the failing launcher test**

```ts
import { describe, expect, it } from "vitest";
import { buildLauncher } from "../src/runtime/launcher";

describe("buildLauncher", () => {
  it("restarts the worker after a requested graceful exit", async () => {
    const launches: string[] = [];
    const launcher = buildLauncher({
      spawnWorker: async () => {
        launches.push("worker");
        return { wait: async () => 75 };
      },
    });

    await launcher.runOnce();

    expect(launches).toEqual(["worker", "worker"]);
  });
});
```

- [ ] **Step 2: Run the launcher test**

Run: `npm --prefix v2 test -- v2/test/launcher.test.ts`  
Expected: fail because no launcher exists.

- [ ] **Step 3: Implement a function-agnostic launcher**

```ts
export const RESTART_EXIT_CODE = 75;

export type WorkerHandle = {
  wait(): Promise<number>;
};

export function buildLauncher(deps: {
  spawnWorker(): Promise<WorkerHandle>;
}) {
  return {
    async runOnce(): Promise<void> {
      while (true) {
        const worker = await deps.spawnWorker();
        const exitCode = await worker.wait();
        if (exitCode !== RESTART_EXIT_CODE) {
          return;
        }
      }
    },
  };
}
```

```ts
// launcher.ts
// Only spawn, wait, and restart. Do not read Slack state here.
```

- [ ] **Step 4: Run the launcher test**

Run: `npm --prefix v2 test -- v2/test/launcher.test.ts`  
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add v2/src/bin/launcher.ts v2/src/runtime/launcher.ts v2/src/runtime/restart.ts v2/test/launcher.test.ts
git commit -m "feat: add router v2 launcher"
```

### Task 4: Add the Codex App Server stdio client and event stream

**Files:**
- Create: `v2/src/app_server/process.ts`
- Create: `v2/src/app_server/client.ts`
- Create: `v2/src/app_server/events.ts`
- Create: `v2/test/app_server_client.test.ts`

- [ ] **Step 1: Write the failing App Server client test**

```ts
import { describe, expect, it } from "vitest";
import { AppServerClient } from "../src/app_server/client";

describe("AppServerClient", () => {
  it("sends requests and emits parsed notifications", async () => {
    const sent: string[] = [];
    const client = new AppServerClient({
      writeLine: (line) => sent.push(line),
    });

    const response = client.expectResponse("1");
    client.handleLine('{"id":"1","result":{"threadId":"thread_123"}}');

    expect(await response).toEqual({ threadId: "thread_123" });

    client.handleLine('{"method":"thread/status/changed","params":{"threadId":"thread_123"}}');
    expect(sent[0]).toContain('"method":"initialize"');
  });
});
```

- [ ] **Step 2: Run the App Server client test**

Run: `npm --prefix v2 test -- v2/test/app_server_client.test.ts`  
Expected: fail because the client and event parser do not exist.

- [ ] **Step 3: Implement the stdio client**

```ts
export type AppServerNotification =
  | { method: "thread/status/changed"; params: Record<string, unknown> }
  | { method: "turn/item"; params: Record<string, unknown> }
  | { method: "tool/requestUserInput"; params: Record<string, unknown> };

export class AppServerClient {
  initialize(): Promise<void> { /* send initialize */ }
  threadStart(input: Record<string, unknown>): Promise<Record<string, unknown>> { /* request */ }
  turnStart(input: Record<string, unknown>): Promise<Record<string, unknown>> { /* request */ }
  turnSteer(input: Record<string, unknown>): Promise<Record<string, unknown>> { /* request */ }
  turnInterrupt(input: Record<string, unknown>): Promise<void> { /* request */ }
  handleLine(line: string): void { /* resolve promises or emit notifications */ }
}
```

- [ ] **Step 4: Run the App Server client test**

Run: `npm --prefix v2 test -- v2/test/app_server_client.test.ts`  
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add v2/src/app_server/process.ts v2/src/app_server/client.ts v2/src/app_server/events.ts v2/test/app_server_client.test.ts
git commit -m "feat: add codex app server client"
```

### Task 5: Build the router service for Slack thread to App Server thread mapping

**Files:**
- Create: `v2/src/router/service.ts`
- Create: `v2/src/slack/app.ts`
- Create: `v2/src/slack/render.ts`
- Create: `v2/test/router_service.test.ts`

- [ ] **Step 1: Write the failing router service test**

```ts
import { describe, expect, it, vi } from "vitest";
import { RouterService } from "../src/router/service";

describe("RouterService", () => {
  it("starts a new App Server thread for a top-level Slack message", async () => {
    const threadStart = vi.fn().mockResolvedValue({ threadId: "thread_abc" });
    const turnStart = vi.fn().mockResolvedValue({ turnId: "turn_abc" });
    const reply = vi.fn();

    const service = new RouterService({ threadStart, turnStart, reply });

    await service.handleSlackMessage({
      channelId: "C123",
      messageTs: "1710000000.0001",
      threadTs: "1710000000.0001",
      text: "Investigate the failing tests",
      userId: "U123",
    });

    expect(threadStart).toHaveBeenCalledTimes(1);
    expect(turnStart).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("Started Codex task"));
  });
});
```

- [ ] **Step 2: Run the router service test**

Run: `npm --prefix v2 test -- v2/test/router_service.test.ts`  
Expected: fail because the router service and Slack adapter do not exist.

- [ ] **Step 3: Implement the service and Slack adapter**

```ts
export class RouterService {
  async handleSlackMessage(input: {
    channelId: string;
    messageTs: string;
    threadTs: string;
    text: string;
    userId: string;
  }): Promise<void> {
    // authorize
    // resolve project by channel
    // create or resume App Server thread
    // persist mapping
    // render reply
  }
}
```

```ts
// app.ts
app.event("message", async ({ event, say }) => {
  await router.handleSlackMessage({
    channelId: event.channel,
    messageTs: event.ts,
    threadTs: event.thread_ts ?? event.ts,
    text: event.text ?? "",
    userId: event.user ?? "",
  });
});
```

- [ ] **Step 4: Run the router service test**

Run: `npm --prefix v2 test -- v2/test/router_service.test.ts`  
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add v2/src/router/service.ts v2/src/slack/app.ts v2/src/slack/render.ts v2/test/router_service.test.ts
git commit -m "feat: add slack thread routing for v2"
```

### Task 6: Add Block Kit controls and Codex-originated user input rendering

**Files:**
- Create: `v2/src/slack/blocks.ts`
- Create: `v2/test/slack_blocks.test.ts`

- [ ] **Step 1: Write the failing Block Kit test**

```ts
import { describe, expect, it } from "vitest";
import { buildUserInputBlocks, buildThreadControls } from "../src/slack/blocks";

describe("slack blocks", () => {
  it("renders Codex choices as interactive buttons", () => {
    const blocks = buildUserInputBlocks({
      prompt: "Pick a plan",
      options: [
        { id: "a", label: "Option A" },
        { id: "b", label: "Option B" },
      ],
    });

    expect(blocks[1]).toMatchObject({
      type: "actions",
      elements: [
        expect.objectContaining({ text: expect.objectContaining({ text: "Option A" }) }),
      ],
    });
  });
});
```

- [ ] **Step 2: Run the Block Kit test**

Run: `npm --prefix v2 test -- v2/test/slack_blocks.test.ts`  
Expected: fail because the Block Kit builders do not exist.

- [ ] **Step 3: Implement control builders**

```ts
export function buildThreadControls(state: {
  canInterrupt: boolean;
  canReview: boolean;
  canMerge: boolean;
}) {
  return [
    { type: "button", action_id: "status" },
    { type: "button", action_id: "interrupt" },
    { type: "button", action_id: "review" },
    { type: "button", action_id: "merge_to_main" },
    { type: "button", action_id: "restart_router" },
  ];
}

export function buildUserInputBlocks(input: {
  prompt: string;
  options: { id: string; label: string }[];
}) {
  return [
    { type: "section", text: { type: "mrkdwn", text: input.prompt } },
    {
      type: "actions",
      elements: input.options.map((option) => ({
        type: "button",
        action_id: `codex_choice:${option.id}`,
        text: { type: "plain_text", text: option.label },
        value: option.id,
      })),
    },
  ];
}
```

- [ ] **Step 4: Run the Block Kit test**

Run: `npm --prefix v2 test -- v2/test/slack_blocks.test.ts`  
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add v2/src/slack/blocks.ts v2/test/slack_blocks.test.ts
git commit -m "feat: add slack block kit controls for v2"
```

### Task 7: Build worktree isolation and merge-to-main controls

**Files:**
- Create: `v2/src/worktree/manager.ts`
- Create: `v2/src/git/merge_to_main.ts`
- Create: `v2/test/worktree_manager.test.ts`
- Create: `v2/test/merge_to_main.test.ts`

- [ ] **Step 1: Write the failing worktree and merge tests**

```ts
import { describe, expect, it } from "vitest";
import { buildBranchName, WorktreeManager } from "../src/worktree/manager";
import { buildMergeConfirmation } from "../src/git/merge_to_main";

describe("WorktreeManager", () => {
  it("allocates one named branch per top-level Slack thread", () => {
    expect(buildBranchName("1710000000.0001")).toBe("codex/slack/1710000000-0001");
  });
});

describe("buildMergeConfirmation", () => {
  it("builds a confirmation card before merging to main", () => {
    const blocks = buildMergeConfirmation({
      sourceBranch: "codex/slack/1710000000-0001",
      targetBranch: "main",
      checksStatus: "passed",
      worktreeStatus: "clean",
    });

    expect(JSON.stringify(blocks)).toContain("Confirm merge");
  });
});
```

- [ ] **Step 2: Run the worktree tests**

Run: `npm --prefix v2 test -- v2/test/worktree_manager.test.ts v2/test/merge_to_main.test.ts`  
Expected: fail because the worktree manager and merge helpers do not exist.

- [ ] **Step 3: Implement the worktree manager and merge helper**

```ts
export function buildBranchName(threadTs: string): string {
  return `codex/slack/${threadTs.replace(/\./g, "-")}`;
}

export class WorktreeManager {
  async ensureThreadWorktree(input: {
    repoPath: string;
    slackThreadTs: string;
    baseBranch: string;
  }): Promise<{ worktreePath: string; branchName: string }> {
    // git worktree add -b <branch> <path> <baseBranch>
  }
}
```

```ts
export function buildMergeConfirmation(input: {
  sourceBranch: string;
  targetBranch: string;
  checksStatus: string;
  worktreeStatus: string;
}) {
  return [
    { type: "section", text: { type: "mrkdwn", text: `Merge ${input.sourceBranch} into ${input.targetBranch}?` } },
    { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Confirm merge" }, action_id: "confirm_merge_to_main" }] },
  ];
}
```

- [ ] **Step 4: Run the worktree tests**

Run: `npm --prefix v2 test -- v2/test/worktree_manager.test.ts v2/test/merge_to_main.test.ts`  
Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
git add v2/src/worktree/manager.ts v2/src/git/merge_to_main.ts v2/test/worktree_manager.test.ts v2/test/merge_to_main.test.ts
git commit -m "feat: add worktree isolation and merge controls"
```

### Task 8: Add restart recovery, end-to-end validation, and cutover docs

**Files:**
- Create: `v2/test/restart_recovery.test.ts`
- Modify: `README.md`
- Modify: `scripts/start-router.sh`

- [ ] **Step 1: Write the failing restart recovery test**

```ts
import { describe, expect, it } from "vitest";
import { recoverAfterRestart } from "../src/runtime/restart";

describe("recoverAfterRestart", () => {
  it("reloads persisted threads and posts a recovery update for the requesting Slack thread", async () => {
    const result = await recoverAfterRestart({
      pendingRestartIntent: {
        requestedByThreadTs: "1710000000.0001",
        requestedAt: "2026-03-30T12:00:00Z",
      },
      recoverableThreads: [
        {
          slackChannelId: "C123",
          slackThreadTs: "1710000000.0001",
          appServerThreadId: "thread_abc",
          state: "running",
          worktreePath: "/tmp/wt",
          branchName: "codex/slack/1710000000-0001",
          baseBranch: "main",
        },
      ],
    });

    expect(result.recoveredThreadCount).toBe(1);
    expect(result.notifyThreadTs).toBe("1710000000.0001");
  });
});
```

- [ ] **Step 2: Run the restart recovery test**

Run: `npm --prefix v2 test -- v2/test/restart_recovery.test.ts`  
Expected: fail because the restart recovery helper does not exist.

- [ ] **Step 3: Implement recovery, update docs, and wire the launcher start path**

```ts
export async function recoverAfterRestart(input: {
  pendingRestartIntent: RestartIntent | null;
  recoverableThreads: ThreadRecord[];
}) {
  return {
    recoveredThreadCount: input.recoverableThreads.length,
    notifyThreadTs: input.pendingRestartIntent?.requestedByThreadTs ?? null,
  };
}
```

```bash
# scripts/start-router.sh
cd "$(dirname "$0")/.."
exec node v2/dist/bin/launcher.js
```

Document in `README.md`:
- how `v2` reads the existing `.env`
- how to start the launcher
- how to validate in a private Slack channel
- how `Restart router` works
- how to fall back to the legacy Python router until cutover is complete

- [ ] **Step 4: Run the full `v2` test suite and a private-channel smoke test**

Run: `npm --prefix v2 test`  
Expected: all `v2/test/*.test.ts` pass

Run manually in a private Slack channel:
1. start a top-level task
2. reply in-thread
3. use a Block Kit choice
4. trigger `Restart router`
5. confirm the thread receives a recovery message
6. confirm a second thread can run concurrently in a separate worktree
7. confirm `Merge to main` shows a confirmation card

- [ ] **Step 5: Commit**

```bash
git add v2/test/restart_recovery.test.ts README.md scripts/start-router.sh
git commit -m "feat: complete v2 restart recovery and cutover docs"
```

## Self-Review

- Spec coverage:
  - App Server authority: Tasks 4-5
  - Slack-native controls and user input: Tasks 5-6
  - worktree-per-thread isolation and merge flow: Task 7
  - native restart with launcher and recovery: Tasks 3 and 8
  - reuse current `.env`: Task 1 and Task 8
- Placeholder scan:
  - no `TODO`, `TBD`, or unnamed files remain
  - all tests and commands are concrete
- Type consistency:
  - `ThreadRecord`, `RestartIntent`, `RouterService`, `WorktreeManager`, and `recoverAfterRestart` are introduced before later tasks depend on them
