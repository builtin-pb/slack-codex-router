# Slack Codex Router v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node-first Slack Codex Router `v2` around Codex App Server with worktree isolation, Slack-native controls, merge-to-main actions, and supervisor-backed native restart while reusing the current `.env` Slack bot setup.

**Architecture:** Add a separate `v2/` TypeScript workspace instead of incrementally mutating the current Python router. A tiny launcher process owns process lifecycle only; the router worker owns Slack, App Server, persistence, recovery, worktrees, and merge actions. Keep the archived Python router under `legacy/v1` in place until the `v2` Slack flow and restart recovery both pass end-to-end in a private channel.

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

Keep the legacy Python code under `legacy/v1/src/slack_codex_router/` unchanged until the final cutover task.

### Task 0: Archive the current Python router as `legacy/v1`

**Files:**
- Create: `legacy/v1/README.md`
- Move: `src/slack_codex_router` -> `legacy/v1/src/slack_codex_router`
- Move: `tests/test_*.py` -> `legacy/v1/tests/`
- Move: `tests/fixtures/codex_exec_sample.jsonl` -> `legacy/v1/tests/fixtures/codex_exec_sample.jsonl`
- Move: `docs/superpowers/specs/2026-03-29-slack-codex-project-router-design.md` -> `legacy/v1/docs/specs/2026-03-29-slack-codex-project-router-design.md`
- Move: `docs/superpowers/plans/2026-03-29-slack-codex-project-router.md` -> `legacy/v1/docs/plans/2026-03-29-slack-codex-project-router.md`
- Move: `scripts/start-router.sh` -> `legacy/v1/scripts/start-router-v1.sh`
- Move: `config/projects.example.yaml` -> `legacy/v1/config/projects.example.yaml`
- Modify: `README.md`
- Create: `scripts/start-router.sh`

- [x] **Step 1: Write the failing archive test**
Observed: Added `tests/test_archive_layout.py` with the Task 0 archive assertions before moving the Python test suite into `legacy/v1/tests`.

```python
from pathlib import Path


def test_v1_router_is_archived_under_legacy_v1() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    assert (repo_root / "legacy" / "v1" / "src" / "slack_codex_router").is_dir()
    assert (repo_root / "legacy" / "v1" / "scripts" / "start-router-v1.sh").is_file()
    assert (repo_root / "scripts" / "start-router.sh").is_file()
```

- [x] **Step 2: Run the archive check to verify it fails**
Observed: `python` was not available on PATH, so I ran the same assertion with `python3`; it failed with `AssertionError` as expected because `legacy/v1/src/slack_codex_router` did not exist yet.

Run: `python - <<'PY'\nfrom pathlib import Path\nrepo = Path.cwd()\nassert (repo / 'legacy' / 'v1' / 'src' / 'slack_codex_router').exists()\nPY`  
Expected: fail because `legacy/v1/src/slack_codex_router` does not exist yet.

- [x] **Step 3: Move the Python router, tests, and v1 docs into `legacy/v1`**
Observed: Moved `src/slack_codex_router`, the Python `tests/test_*.py` files plus fixture, the March 29 v1 spec/plan docs, `config/projects.example.yaml`, and the original wrapper into `legacy/v1`; added `legacy/v1/README.md`, a `legacy/v1/tests/conftest.py` path shim, and updated `legacy/v1/scripts/start-router-v1.sh` so it still launches the archived router from `legacy/v1/src` while reading the repo-root `.env`. Follow-up stabilization also pointed root `pyproject.toml` packaging and default `pytest` discovery at `legacy/v1`, and kept the root wrapper as a delegate-only handoff that prints the `v2`-not-ready message before execing `legacy/v1/scripts/start-router-v1.sh`.

```bash
mkdir -p legacy/v1/src legacy/v1/tests/fixtures legacy/v1/docs/specs legacy/v1/docs/plans legacy/v1/scripts legacy/v1/config
mv src/slack_codex_router legacy/v1/src/
mv tests/test_*.py legacy/v1/tests/
mv tests/fixtures/codex_exec_sample.jsonl legacy/v1/tests/fixtures/
mv docs/superpowers/specs/2026-03-29-slack-codex-project-router-design.md legacy/v1/docs/specs/
mv docs/superpowers/plans/2026-03-29-slack-codex-project-router.md legacy/v1/docs/plans/
mv scripts/start-router.sh legacy/v1/scripts/start-router-v1.sh
mv config/projects.example.yaml legacy/v1/config/
```

Create `legacy/v1/README.md` describing:
- this is the archived Python `v1` router
- the repo root is being repurposed for `v2`
- `legacy/v1/scripts/start-router-v1.sh` is the historical wrapper

Create a new root `scripts/start-router.sh` that only delegates to archived `v1` for now:

```bash
#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

echo "v2 is not ready yet; delegating to archived legacy/v1 router." >&2
exec "$ROOT_DIR/legacy/v1/scripts/start-router-v1.sh" "$@"
```

Update root `README.md` so the first screen says:
- `v1` is archived under `legacy/v1`
- `v2` is the active rewrite target
- current root wrapper temporarily prints that `v2` is not ready yet, then delegates to the archived `v1` script until `v2` lands

- [x] **Step 4: Run the archive checks**
Observed: The layout assertion passed via `python3`, printing `archive layout ok`; follow-up verification also kept the root handoff stable by fixing the archived fixture path, adding a root-wrapper delegation test, making `scripts/start-router.sh` always delegate during early `v2` work, and rerunning `uv run pytest legacy/v1/tests` (`92 passed in 1.13s`), `uv run pytest` (`92 passed in 1.16s`), and `uv run python -m slack_codex_router.main run --help` (printed argparse help and exited 0) successfully.

Run: `python - <<'PY'\nfrom pathlib import Path\nrepo = Path.cwd()\nassert (repo / 'legacy' / 'v1' / 'src' / 'slack_codex_router').is_dir()\nassert (repo / 'legacy' / 'v1' / 'scripts' / 'start-router-v1.sh').is_file()\nassert (repo / 'scripts' / 'start-router.sh').is_file()\nprint('archive layout ok')\nPY`  
Expected: prints `archive layout ok`

- [x] **Step 5: Commit**
Observed: Created the requested commit with message `refactor: archive python router as legacy v1`; a follow-up stabilization commit (`fix: stabilize legacy v1 archive handoff`) adjusts the archive handoff without changing Task 0 scope.

```bash
git add legacy/v1 README.md scripts/start-router.sh src tests docs/superpowers config
git commit -m "refactor: archive python router as legacy v1"
```

### Task 1: Bootstrap the `v2` TypeScript workspace

**Files:**
- Create: `v2/package.json`
- Create: `v2/tsconfig.json`
- Create: `v2/.env.example`
- Create: `v2/src/config.ts`
- Create: `v2/src/bin/router.ts`
- Create: `v2/test/config.test.ts`

- [x] **Step 1: Write the failing config test**
Observed: Added `v2/test/config.test.ts` first, covering the current root Slack user-id contract plus the repo-root `SCR_PROJECTS_FILE` and `SCR_STATE_DB` aliases, and adding a quoted-command case so the parser behavior is pinned down.

```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const baseEnv = {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_APP_TOKEN: "xapp-test",
    SLACK_ALLOWED_USER_ID: "U123",
  };

  it("loads the Slack env contract and v2 defaults from repo-root aliases", () => {
    const config = loadConfig({
      ...baseEnv,
      SCR_PROJECTS_FILE: "config/projects.example.yaml",
      SCR_STATE_DB: "tmp/router-v2.sqlite3",
    });

    expect(config.slackBotToken).toBe("xoxb-test");
    expect(config.slackAppToken).toBe("xapp-test");
    expect(config.allowedUserId).toBe("U123");
    expect(config.projectsFile).toContain("config/projects.example.yaml");
    expect(config.routerStateDb).toContain("tmp/router-v2.sqlite3");
    expect(config.appServerCommand).toEqual(["codex", "app-server"]);
  });

  it("parses quoted app-server commands", () => {
    const config = loadConfig({
      ...baseEnv,
      SCR_PROJECTS_FILE: "config/projects.example.yaml",
      SCR_STATE_DB: "tmp/router-v2.sqlite3",
      CODEX_APP_SERVER_COMMAND: 'codex app-server --label "My Project"',
    });

    expect(config.appServerCommand).toEqual([
      "codex",
      "app-server",
      "--label",
      "My Project",
    ]);
  });
});
```

- [x] **Step 2: Run the test to confirm the workspace is missing**
Observed: `npm --prefix v2 test -- v2/test/config.test.ts` failed with `npm error enoent Could not read package.json` because `v2/package.json` did not exist yet, which confirmed the red state came from the missing workspace.

Run: `npm --prefix v2 test -- v2/test/config.test.ts`  
Expected: fail because `v2/package.json` and `src/config.ts` do not exist yet.

- [x] **Step 3: Create the minimal workspace and config loader**
Observed: Created `v2/package.json`, `v2/tsconfig.json`, `v2/.env.example`, `v2/src/config.ts`, `v2/src/bin/router.ts`, `v2/package-lock.json`, and `v2/.gitignore`; the loader now prefers `SLACK_ALLOWED_USER_ID`, falls back to `ALLOWED_SLACK_USER_ID`, accepts `SCR_PROJECTS_FILE` and `SCR_STATE_DB` as repo-root aliases, and `npm --prefix v2 install` completed successfully.

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
    allowedUserId: requireAnyEnv(env, [
      "SLACK_ALLOWED_USER_ID",
      "ALLOWED_SLACK_USER_ID",
    ]),
    projectsFile: optionalAnyEnv(env, [
      "PROJECTS_FILE",
      "SCR_PROJECTS_FILE",
    ], "config/projects.yaml"),
    routerStateDb: optionalAnyEnv(env, [
      "ROUTER_STATE_DB",
      "SCR_STATE_DB",
    ], "logs/router-v2/state.sqlite3"),
    appServerCommand: parseCommand(
      env.CODEX_APP_SERVER_COMMAND ?? "codex app-server",
    ),
  };
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value && value.trim().length > 0) {
    return value;
  }

  throw new Error(`Missing required environment variable: ${key}`);
}

function requireAnyEnv(env: NodeJS.ProcessEnv, keys: string[]): string {
  for (const key of keys) {
    const value = env[key];
    if (value && value.trim().length > 0) {
      return value;
    }
  }

  throw new Error(
    `Missing required environment variable: one of ${keys.join(", ")}`,
  );
}

function optionalAnyEnv(
  env: NodeJS.ProcessEnv,
  keys: string[],
  defaultValue: string,
): string {
  for (const key of keys) {
    const value = env[key];
    if (value && value.trim().length > 0) {
      return value;
    }
  }

  return defaultValue;
}

function parseCommand(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of command.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (quote === "'") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = null;
      } else if (char === "\\") {
        escaping = true;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    throw new Error("Unterminated escape in CODEX_APP_SERVER_COMMAND");
  }

  if (quote !== null) {
    throw new Error("Unterminated quote in CODEX_APP_SERVER_COMMAND");
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}
```

```ts
import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";

const routerDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(routerDir, "../../..");
const dotenvPath = process.env.DOTENV_CONFIG_PATH ?? resolve(repoRoot, ".env");

loadDotenv({ path: dotenvPath });

export function main(): void {
  const config = loadConfig();
  console.log(
    `v2 router bootstrap ready for ${config.allowedUserId} with ${config.projectsFile}`,
  );
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main();
}
```

- [x] **Step 4: Run the config test**
Observed: `npm --prefix v2 test -- test/config.test.ts` passed (`2 tests`), and `npm --prefix v2 run build` also succeeded with `tsc -p tsconfig.json`.

Run: `npm --prefix v2 test -- test/config.test.ts`  
Expected: `2 passed`

- [x] **Step 5: Commit**
Observed: Created the initial bootstrap commit `88218c3` with the requested message `feat: bootstrap slack codex router v2 workspace`, including the new workspace files and the Task 1 plan-log update. Later Task 1 quality fixes and plan-log corrections landed in follow-up commits, so the bootstrap commit below should be read as the first Task 1 checkpoint rather than the entire Task 1 history.

```bash
git add docs/agent/plans/2026-03-30-slack-codex-v2.md v2/package.json v2/tsconfig.json v2/.env.example v2/.gitignore v2/package-lock.json v2/src/config.ts v2/src/bin/router.ts v2/test/config.test.ts
git commit -m "feat: bootstrap slack codex router v2 workspace"
```

### Task 2: Add the `v2` persistence schema and recovery primitives

**Files:**
- Create: `v2/src/domain/types.ts`
- Create: `v2/src/persistence/schema.ts`
- Create: `v2/src/persistence/store.ts`
- Create: `v2/test/store.test.ts`

- [x] **Step 1: Write the failing store test**
Observed: Added `v2/test/store.test.ts` first, covering thread routing, worktree metadata, and pending restart intent before any persistence code existed.

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

- [x] **Step 2: Run the store test**
Observed: `npm --prefix v2 test -- test/store.test.ts` failed with `Cannot find module '../src/persistence/store.js'`, which was the expected red state because the persistence layer had not been created yet.

Run: `npm --prefix v2 test -- v2/test/store.test.ts`  
Expected: fail because `RouterStore` and schema tables do not exist yet.

- [x] **Step 3: Implement the schema and store**
Observed: Added `v2/src/domain/types.ts`, `v2/src/persistence/schema.ts`, and `v2/src/persistence/store.ts` with SQLite-backed `threads`, `slack_messages`, `interactive_prompts`, and `restart_intents` tables keyed by `(slack_channel_id, slack_thread_ts)` plus `RouterStore` methods for composite lookup, recovery listing, restart-intent lifecycle, and explicit close support.

```ts
export type SlackThreadIdentity = {
  slackChannelId: string;
  slackThreadTs: string;
};

export type ThreadRecord = {
  slackChannelId: string;
  slackThreadTs: string;
  appServerThreadId: string;
  state: "idle" | "running" | "awaiting_user_input" | "interrupted" | "failed_setup";
  worktreePath: string;
  branchName: string;
  baseBranch: string;
};

export type RestartIntent = SlackThreadIdentity & {
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
  getThread(slackChannelId: string, slackThreadTs: string): ThreadRecord | null { /* select */ }
  listRecoverableThreads(): ThreadRecord[] { /* select active */ }
  recordRestartIntent(intent: RestartIntent): void { /* insert */ }
  getPendingRestartIntent(): RestartIntent | null { /* select latest */ }
  clearRestartIntent(): void { /* delete */ }
  close(): void { /* close the database */ }
}
```

- [x] **Step 4: Run the store test**
Observed: `npm --prefix v2 test -- test/store.test.ts` passed (`3 tests`), and `npm --prefix v2 run build` passed after switching the store to a local runtime interface for `better-sqlite3`.

Run: `npm --prefix v2 test -- v2/test/store.test.ts`  
Expected: `3 passed`

- [x] **Step 5: Commit**
Observed: Created the initial Task 2 implementation commit `87b63ca` with message `feat: add v2 persistence schema`; later hardening and plan-audit corrections landed in follow-up commits, so this step should be read as the first Task 2 checkpoint rather than the entire Task 2 history.

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

- [x] **Step 1: Write the failing launcher test**
Observed: Added `v2/test/launcher.test.ts` first, keeping the Task 3 contract focused on a single graceful-restart cycle where the first worker exits with the dedicated restart code and the second worker exits normally.

```ts
import { describe, expect, it } from "vitest";
import { buildLauncher } from "../src/runtime/launcher";

describe("buildLauncher", () => {
  it("restarts the worker after a requested graceful exit", async () => {
    const launches: string[] = [];
    const launcher = buildLauncher({
      spawnWorker: async () => {
        launches.push("worker");
        return {
          wait: async () =>
            launches.length === 1 ? 75 : 0,
        };
      },
    });

    await launcher.runOnce();

    expect(launches).toEqual(["worker", "worker"]);
  });
});
```

- [x] **Step 2: Run the launcher test**
Observed: The literal plan command `npm --prefix v2 test -- v2/test/launcher.test.ts` did not match Vitest's path resolution under `--prefix v2` and returned `No test files found`; rerunning as `npm --prefix v2 test -- test/launcher.test.ts` produced the intended red state with `Cannot find module '../src/runtime/launcher.js'`.

Run: `npm --prefix v2 test -- test/launcher.test.ts`  
Expected: fail because no launcher exists.

- [x] **Step 3: Implement a function-agnostic launcher**
Observed: Added `v2/src/runtime/restart.ts` with the dedicated restart exit-code contract, `v2/src/runtime/launcher.ts` with the minimal spawn/wait/restart loop, and `v2/src/bin/launcher.ts` as a tiny CLI wrapper that only spawns the router worker and inherits stdio.

```ts
export const RESTART_EXIT_CODE = 75;

export type WorkerHandle = {
  wait(): Promise<number>;
};

export function buildLauncher(deps: {
  spawnWorker(): Promise<WorkerHandle>;
}) {
  return {
    async runOnce(): Promise<number> {
      while (true) {
        const worker = await deps.spawnWorker();
        const exitCode = await worker.wait();
        if (exitCode !== RESTART_EXIT_CODE) {
          return exitCode;
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

- [x] **Step 4: Run the launcher test**
Observed: `npm --prefix v2 test -- test/launcher.test.ts` passed with `3 passed` after adding coverage for non-restart exit-code propagation and signal forwarding; additional required verification also succeeded with `npm --prefix v2 run build`.

Run: `npm --prefix v2 test -- test/launcher.test.ts`  
Expected: `3 passed`

- [x] **Step 5: Commit**
Observed: Created the initial Task 3 implementation commit as `0fa41b1` with message `feat: add router v2 launcher`; later hardening for exit-code propagation, signal forwarding, and plan-log corrections landed in follow-up commits, so this step should be read as the first Task 3 checkpoint rather than the entire Task 3 history.

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

- [x] **Step 1: Write the failing App Server client test**
Observed: Added `v2/test/app_server_client.test.ts` first, covering the narrow client API only: `initialize`, `threadStart`, `turnStart`, `turnSteer`, `turnInterrupt`, request-id correlation, notification emission, and server error propagation.

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

- [x] **Step 2: Run the App Server client test**
Observed: `npm --prefix /Users/builtin.pb/Desktop/Template/v2 test -- /Users/builtin.pb/Desktop/Template/v2/test/app_server_client.test.ts` failed in the expected red state with `Cannot find module '../src/app_server/client.js'` because the new App Server files did not exist yet.

Run: `npm --prefix v2 test -- v2/test/app_server_client.test.ts`  
Expected: fail because the client and event parser do not exist.

- [x] **Step 3: Implement the stdio client**
Observed: Added `v2/src/app_server/events.ts`, `v2/src/app_server/client.ts`, and `v2/src/app_server/process.ts`. The implementation stays narrow: a typed notification parser and subscription stream, JSON line request/response correlation with minimal App Server methods, and a thin stdio spawn wrapper for later tasks to attach to.

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

- [x] **Step 4: Run the App Server client test**
Observed: `npm --prefix /Users/builtin.pb/Desktop/Template/v2 test -- /Users/builtin.pb/Desktop/Template/v2/test/app_server_client.test.ts` passed (`1 passed`, `2 passed` tests after extending the contract), and `npm --prefix /Users/builtin.pb/Desktop/Template/v2 run build` then succeeded after tightening the `events.ts` type guards for strict TypeScript compilation.

Run: `npm --prefix v2 test -- v2/test/app_server_client.test.ts`  
Expected: `1 passed`

- [x] **Step 5: Commit**
Observed: Created the requested commit with message `feat: add codex app server client` (`5bce571`).

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
  - archive current Python router before `v2` execution begins: Task 0
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
