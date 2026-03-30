# Slack Codex Router v2 Test Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a layered `v2` test pyramid that improves low-level coverage, adds reusable in-process integration harnesses, adds high-signal process smokes, and exposes a stable coverage command.

**Architecture:** Keep production runtime structure intact. Improve confidence by adding tests from the bottom up: pure/unit logic first, then boundary-contract tests, then integrated runtime-flow tests using real `RouterStore`/`RouterService`/runtime wiring with fake external edges, then short-lived child-process smoke tests for entrypoints. Keep each workstream in a mostly disjoint file set so parallel workers can move independently.

**Tech Stack:** TypeScript, Node.js, Vitest, Vitest v8 coverage provider, Slack Bolt interfaces, SQLite via `better-sqlite3`, child-process fixture scripts

---

## File Structure

- Modify: `v2/package.json`
- Modify: `v2/package-lock.json`
- Modify: `v2/test/config.test.ts`
- Modify: `v2/test/router_runtime_events.test.ts`
- Modify: `v2/test/launcher.test.ts`
- Create: `v2/test/router_events.test.ts`
- Create: `v2/test/router_bin_smoke.test.ts`
- Create: `v2/test/launcher_bin_smoke.test.ts`
- Create: `v2/test/runtime_harness.test.ts`
- Create: `v2/test/integration_runtime_flow.test.ts`
- Create: `v2/test/integration_slack_controls.test.ts`
- Create: `v2/test/helpers/runtime_harness.ts`
- Create: `v2/test/helpers/fake_slack_app.ts`
- Create: `v2/test/helpers/temp_project.ts`

### Task 1: Add native coverage tooling and close low-level logic gaps

**Files:**
- Modify: `v2/package.json`
- Modify: `v2/package-lock.json`
- Modify: `v2/test/config.test.ts`
- Create: `v2/test/router_events.test.ts`

- [x] **Step 1: Write the failing low-level coverage tests and coverage-script expectation**
Observed: Added `v2/test/router_events.test.ts` and expanded `v2/test/config.test.ts` well beyond the initial minimal slice: the final test set covers nested status fallback, user-input prompt extraction, assistant content-array fallback, absolute-path preservation, quoted and escaped app-server command parsing, and the parser error branches for unterminated escape/quote.

```ts
// v2/test/router_events.test.ts
import { describe, expect, it } from "vitest";
import { toRouterEventEffect } from "../src/router/events.js";

describe("toRouterEventEffect", () => {
  it("maps nested active status payloads onto running thread state", () => {
    expect(
      toRouterEventEffect({
        method: "thread/status/changed",
        params: {
          threadId: "thread_abc",
          status: { type: "active" },
        },
      }),
    ).toEqual({
      threadId: "thread_abc",
      state: "running",
    });
  });

  it("ignores notifications that do not affect router-visible state", () => {
    expect(
      toRouterEventEffect({
        method: "tool/call/started",
        params: { threadId: "thread_abc" },
      }),
    ).toBeNull();
  });
});
```

```ts
// v2/test/config.test.ts
it("accepts SCR_STATE_DB relative paths from DOTENV-driven repo root resolution", () => {
  process.env.SCR_STATE_DB = "state/router.sqlite3";
  expect(loadConfig().routerStateDb).toContain("state/router.sqlite3");
});
```

```json
// v2/package.json
{
  "scripts": {
    "coverage": "vitest run --coverage"
  }
}
```

- [x] **Step 2: Run the targeted tests to verify they fail**
Observed: The new low-level slices were first run in the red state before the files and expectations were in place; the worker verified failure before locking the final test set.

Run: `npm --prefix v2 test -- test/config.test.ts test/router_events.test.ts`
Expected: FAIL because `router_events.test.ts` does not exist yet and the active-status mapping or ignored-notification coverage is missing.

- [x] **Step 3: Implement minimal low-level test support and coverage script**
Observed: `v2/package.json` now exposes a native `coverage` script and `@vitest/coverage-v8` is pinned in `v2/package-lock.json`.

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/bin/router.ts",
    "test": "vitest run",
    "coverage": "vitest run --coverage.enabled=true --coverage.provider=v8"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@vitest/coverage-v8": "^3.2.4",
    "tsx": "^4.20.0",
    "typescript": "^5.8.0",
    "vitest": "^3.1.0"
  }
}
```

```ts
// v2/test/router_events.test.ts
import { describe, expect, it } from "vitest";
import { toRouterEventEffect } from "../src/router/events.js";

describe("toRouterEventEffect", () => {
  it("maps nested active status payloads onto running thread state", () => {
    expect(
      toRouterEventEffect({
        method: "thread/status/changed",
        params: {
          threadId: "thread_abc",
          status: { type: "active" },
        },
      }),
    ).toEqual({
      threadId: "thread_abc",
      state: "running",
    });
  });

  it("maps idle transitions to idle thread state", () => {
    expect(
      toRouterEventEffect({
        method: "thread/status/changed",
        params: {
          threadId: "thread_abc",
          state: "idle",
        },
      }),
    ).toEqual({
      threadId: "thread_abc",
      state: "idle",
    });
  });

  it("ignores notifications that do not affect router-visible state", () => {
    expect(
      toRouterEventEffect({
        method: "tool/call/started",
        params: { threadId: "thread_abc" },
      }),
    ).toBeNull();
  });
});
```

- [x] **Step 4: Run the targeted tests to verify they pass**
Observed: `npm --prefix v2 test -- test/config.test.ts test/router_events.test.ts` passed with `27` targeted tests green after the coverage-focused expansion.

Run: `npm --prefix v2 test -- test/config.test.ts test/router_events.test.ts`
Expected: PASS

- [x] **Step 5: Verify the coverage command works**
Observed: `npm --prefix v2 run coverage` now runs natively without missing-provider errors; the focused low-level run reported `src/config.ts` at `100%` lines/branches and `src/router/events.ts` at `93.98%` lines during worker verification.

Run: `npm --prefix v2 run coverage -- test/router_events.test.ts test/config.test.ts`
Expected: PASS with a Vitest coverage summary instead of a missing-provider error.

- [ ] **Step 6: Commit**

```bash
git add v2/package.json v2/package-lock.json v2/test/config.test.ts v2/test/router_events.test.ts
git commit -m "test: add native coverage tooling and event mapping coverage"
```

### Task 2: Build reusable in-process runtime harness helpers

**Files:**
- Create: `v2/test/helpers/fake_slack_app.ts`
- Create: `v2/test/helpers/temp_project.ts`
- Create: `v2/test/helpers/runtime_harness.ts`
- Create: `v2/test/runtime_harness.test.ts`

- [x] **Step 1: Write the failing helper-driven integration harness tests**
Observed: Added `v2/test/runtime_harness.test.ts` as the first red test for the reusable runtime harness layer.

```ts
// v2/test/runtime_harness.test.ts
import { describe, expect, it } from "vitest";
import { createRuntimeHarness } from "./helpers/runtime_harness.js";

describe("runtime harness", () => {
  it("boots a real router stack and exposes registered message handlers", async () => {
    const harness = await createRuntimeHarness();

    try {
      expect(harness.slack.messageHandler).toBeTypeOf("function");
      expect(harness.routerService).toBeDefined();
      expect(harness.store).toBeDefined();
    } finally {
      harness.cleanup();
    }
  });
});
```

- [x] **Step 2: Run the targeted tests to verify they fail**
Observed: `npm --prefix v2 test -- test/runtime_harness.test.ts` failed first with the expected missing-module red state before the helpers existed.

Run: `npm --prefix v2 test -- test/runtime_harness.test.ts`
Expected: FAIL because the shared runtime harness helpers do not exist yet.

- [x] **Step 3: Implement the minimal shared helpers**
Observed: Added `v2/test/helpers/fake_slack_app.ts`, `v2/test/helpers/temp_project.ts`, and `v2/test/helpers/runtime_harness.ts`; the harness now boots real `RouterStore`, `RouterService`, and `startRouterRuntime`, while faking only Slack and App Server edges.

```ts
// v2/test/helpers/fake_slack_app.ts
export function createFakeSlackApp() {
  const actions = new Map<string, (...args: unknown[]) => Promise<void>>();
  let messageHandler: ((args: Record<string, unknown>) => Promise<void>) | null = null;
  const postedMessages: Array<Record<string, unknown>> = [];

  return {
    app: {
      event(name: "message", handler: (...args: unknown[]) => Promise<void>) {
        if (name === "message") {
          messageHandler = handler as (args: Record<string, unknown>) => Promise<void>;
        }
      },
      action(actionId: string | RegExp, handler: (...args: unknown[]) => Promise<void>) {
        actions.set(String(actionId), handler);
      },
      start: async () => undefined,
      client: {
        chat: {
          postMessage: async (message: Record<string, unknown>) => {
            postedMessages.push(message);
          },
        },
      },
    },
    get messageHandler() {
      return messageHandler;
    },
    postedMessages,
    actions,
  };
}
```

```ts
// v2/test/helpers/temp_project.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createTempProjectFixture() {
  const tempDir = mkdtempSync(join(tmpdir(), "v2-runtime-harness-"));
  const projectDir = join(tempDir, "project");
  const projectsFile = join(tempDir, "projects.yaml");
  const routerStateDb = join(tempDir, "router.sqlite3");

  writeFileSync(
    projectsFile,
    [
      "projects:",
      "  - channel_id: C08TEMPLATE",
      "    name: template",
      `    path: ${JSON.stringify(projectDir)}`,
    ].join("\n"),
    "utf8",
  );

  return {
    projectDir,
    projectsFile,
    routerStateDb,
    config: {
      slackBotToken: "xoxb-test",
      slackAppToken: "xapp-test",
      allowedUserId: "U123",
      projectsFile,
      routerStateDb,
      appServerCommand: ["codex", "app-server"],
    },
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}
```

```ts
// v2/test/helpers/runtime_harness.ts
export async function createRuntimeHarness() {
  const project = createTempProjectFixture();
  const slack = createFakeSlackApp();
  const store = new RouterStore(project.routerStateDb);
  const routerService = new RouterService({
    allowedUserId: "U123",
    projectsFile: project.projectsFile,
    store,
    threadStart: async () => ({ threadId: "thread_abc" }),
    turnStart: async () => ({ turnId: "turn_abc" }),
  });

  await startRouterRuntime({
    config: project.config,
    store,
    appServerProcess: project.appServerProcess,
    appServerClient: project.appServerClient,
    slackApp: slack.app,
    routerService,
    registerSlackMessageHandler,
  });

  return {
    store,
    routerService,
    slack,
    project,
    cleanup() {
      store.close();
      project.cleanup();
    },
  };
}
```

- [x] **Step 4: Run the targeted tests to verify they pass**
Observed: `npm --prefix v2 test -- test/runtime_harness.test.ts` passed after the helpers were implemented.

Run: `npm --prefix v2 test -- test/runtime_harness.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add v2/test/helpers/fake_slack_app.ts v2/test/helpers/temp_project.ts v2/test/helpers/runtime_harness.ts v2/test/runtime_harness.test.ts
git commit -m "test: add reusable v2 runtime integration harness"
```

### Task 3: Add real multi-module runtime and Slack-control integration coverage

**Files:**
- Create: `v2/test/integration_runtime_flow.test.ts`
- Create: `v2/test/integration_slack_controls.test.ts`
- Modify: `v2/test/router_runtime_events.test.ts`

- [x] **Step 1: Write the failing integration tests for message flow and control flow**
Observed: Added `v2/test/integration_runtime_flow.test.ts` and `v2/test/integration_slack_controls.test.ts` to prove a real multi-module path through handler registration, `RouterService`, `RouterStore`, and runtime notification bridging.

```ts
// v2/test/integration_runtime_flow.test.ts
it("routes a top-level slack message through router service into persisted thread state and rendered runtime output", async () => {
  const harness = await createRuntimeHarness();

  try {
    await harness.slack.messageHandler?.({
      event: {
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0001",
        thread_ts: undefined,
        text: "Investigate the repo",
      },
      say: async () => undefined,
    });

    harness.emitNotification({
      method: "item/completed",
      params: {
        threadId: "thread_abc",
        item: { type: "message", role: "assistant", text: "Working on it." },
      },
    });

    expect(harness.store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      appServerThreadId: "thread_abc",
      state: "running",
    });
    expect(harness.slack.postedMessages).toContainEqual(
      expect.objectContaining({
        channel: "C08TEMPLATE",
        thread_ts: "1710000000.0001",
        text: "Working on it.",
      }),
    );
  } finally {
    harness.cleanup();
  }
});
```

```ts
// v2/test/integration_slack_controls.test.ts
it("registers live slack actions that operate on real persisted thread state", async () => {
  const harness = await createRuntimeHarness({ seedThread: true });

  try {
    const handler = harness.getAction("status");
    await handler?.({
      ack: async () => undefined,
      respond: async (message: Record<string, unknown>) => {
        harness.actionResponses.push(message);
      },
      body: {
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        container: { thread_ts: "1710000000.0001" },
        actions: [{ action_id: "status" }],
      },
    });

    expect(harness.actionResponses[0]).toMatchObject({
      text: expect.stringContaining("Status:"),
    });
  } finally {
    harness.cleanup();
  }
});
```

- [x] **Step 2: Run the targeted tests to verify they fail**
Observed: `npm --prefix v2 test -- test/integration_runtime_flow.test.ts test/integration_slack_controls.test.ts` failed in the red state because the harness was still missing `dispatchTopLevelMessage()` and `dispatchAction()`.

Run: `npm --prefix v2 test -- test/integration_runtime_flow.test.ts test/integration_slack_controls.test.ts`
Expected: FAIL because the shared harness will not yet expose the needed control hooks and the integrated runtime flow is not yet encoded.

- [x] **Step 3: Implement the minimal integrated runtime-flow tests**
Observed: Expanded `v2/test/helpers/runtime_harness.ts` and `v2/test/helpers/fake_slack_app.ts` with dispatch helpers, seeded-thread support, and response capture so the integrated tests could drive real handler and control flows.

```ts
// v2/test/integration_runtime_flow.test.ts
describe("integrated runtime flow", () => {
  it("creates a thread mapping, starts a turn, and posts runtime output into the same slack thread", async () => {
    const harness = await createRuntimeHarness();

    try {
      await harness.dispatchTopLevelMessage({
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0001",
        text: "Investigate the repo",
      });

      harness.emitNotification({
        method: "thread/status/changed",
        params: { threadId: "thread_abc", state: "running" },
      });
      harness.emitNotification({
        method: "item/completed",
        params: {
          threadId: "thread_abc",
          item: { type: "message", role: "assistant", text: "Working on it." },
        },
      });

      expect(harness.store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
        appServerThreadId: "thread_abc",
        state: "running",
      });
      expect(harness.slack.postedMessages.at(-1)).toMatchObject({
        channel: "C08TEMPLATE",
        thread_ts: "1710000000.0001",
        text: "Working on it.",
      });
    } finally {
      harness.cleanup();
    }
  });
});
```

- [x] **Step 4: Run the targeted tests to verify they pass**
Observed: `npm --prefix v2 test -- test/integration_runtime_flow.test.ts test/integration_slack_controls.test.ts test/router_runtime_events.test.ts` passed with `3` files and `8` tests green.

Run: `npm --prefix v2 test -- test/integration_runtime_flow.test.ts test/integration_slack_controls.test.ts test/router_runtime_events.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add v2/test/integration_runtime_flow.test.ts v2/test/integration_slack_controls.test.ts v2/test/router_runtime_events.test.ts v2/test/helpers/runtime_harness.ts v2/test/helpers/fake_slack_app.ts
git commit -m "test: cover integrated runtime and slack control flows"
```

### Task 4: Add process-level smoke tests for launcher and router entrypoints

**Files:**
- Create: `v2/test/router_bin_smoke.test.ts`
- Create: `v2/test/launcher_bin_smoke.test.ts`
- Modify: `v2/test/launcher.test.ts`

- [x] **Step 1: Write the failing process smoke tests**
Observed: Added `v2/test/router_bin_smoke.test.ts` and `v2/test/launcher_bin_smoke.test.ts`, then tightened `v2/test/launcher.test.ts` to pin final exit-code behavior in the restart path.

```ts
// v2/test/router_bin_smoke.test.ts
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";

describe("router entry smoke", () => {
  it("exits non-zero and prints the missing-projects failure under controlled env", async () => {
    const child = spawn(process.execPath, ["dist/src/bin/router.js"], {
      cwd: new URL("../", import.meta.url),
      env: {
        ...process.env,
        DOTENV_CONFIG_PATH: "/tmp/nonexistent.env",
      },
    });

    // collect stderr/stdout and assert non-zero exit
  });
});
```

```ts
// v2/test/launcher_bin_smoke.test.ts
it("propagates the worker exit code when the router child exits once", async () => {
  // launch a tiny fixture that imports buildLauncher and exits with a fixed code
});
```

- [x] **Step 2: Run the targeted tests to verify they fail**
Observed: The initial smoke slice was run red before the fixture/assertion work was complete.

Run: `npm --prefix v2 test -- test/router_bin_smoke.test.ts test/launcher_bin_smoke.test.ts`
Expected: FAIL because the smoke tests and fixture behavior are not implemented yet.

- [x] **Step 3: Implement the minimal child-process smoke coverage**
Observed: The final smoke implementation runs `src/bin/router.ts` through `tsx`, asserts the exact missing-projects failure path, exercises the launcher entrypoint through a temp sandbox source tree, and uses timeout/forced-kill cleanup to prevent hangs. Follow-up direct-source tests also added `v2/test/router_main_entry.test.ts` and `v2/test/launcher_main_entry.test.ts`, plus extra mocked-entrypoint coverage in `v2/test/router_bootstrap_wiring.test.ts` and `v2/test/launcher.test.ts`.

```ts
// v2/test/launcher_bin_smoke.test.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

it("propagates a worker exit code through the launcher runtime", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "launcher-smoke-"));
  const scriptPath = join(tempDir, "launcher-smoke.mjs");

  writeFileSync(
    scriptPath,
    [
      'import { buildLauncher } from "../src/runtime/launcher.js";',
      'const launcher = buildLauncher({ spawnWorker: async () => ({ wait: async () => 4 }) });',
      'process.exitCode = await launcher.runOnce();',
    ].join("\n"),
    "utf8",
  );

  // spawn process.execPath, assert exit code 4
});
```

- [x] **Step 4: Run the targeted tests to verify they pass**
Observed: `npm --prefix v2 test -- test/router_bin_smoke.test.ts test/launcher_bin_smoke.test.ts test/launcher.test.ts` passed after the smoke review fixes, and the later direct-source entrypoint slice also passed with `4` files and `9` tests green.

Run: `npm --prefix v2 test -- test/router_bin_smoke.test.ts test/launcher_bin_smoke.test.ts test/launcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add v2/test/router_bin_smoke.test.ts v2/test/launcher_bin_smoke.test.ts v2/test/launcher.test.ts
git commit -m "test: add process smoke coverage for v2 entrypoints"
```

### Task 5: Run the full verification stack and close the plan

**Files:**
- Modify: `docs/agent/plans/2026-03-30-v2-test-architecture.md`

- [x] **Step 1: Run the full v2 test suite**
Observed: Final verification: `npm --prefix v2 test` passed with `40` files and `138` tests green.

Run: `npm --prefix v2 test`
Expected: PASS

- [x] **Step 2: Run the full v2 coverage suite**
Observed: Final verification: `npm --prefix v2 run coverage` passed and reported `93.63%` statements/lines, `87.75%` branches, and `89.74%` functions for `v2`.

Run: `npm --prefix v2 run coverage`
Expected: PASS with a coverage table and no missing-provider error.

- [x] **Step 3: Record observed coverage improvements for key files**
Observed: Key deltas from the earlier baseline in this session: `src/bin/launcher.ts` rose from `36.11%` to `97.22%` lines, `src/bin/router.ts` rose from `62.9%` to `77.41%` lines, `src/router/events.ts` rose from `62.84%` to `93.98%` lines, and `src/config.ts` rose from `80.46%` to `100%` lines.

```text
Capture the before/after coverage deltas for:
- src/bin/launcher.ts
- src/bin/router.ts
- src/router/events.ts
- src/config.ts
```

- [x] **Step 4: Update this plan file with Observed lines for every completed step**
Observed: Backfilled the execution log in this plan with the real outcomes and verification results while the command output was fresh.

```md
Observed: `npm --prefix v2 test` passed with all files green; coverage for `src/bin/launcher.ts` rose from the previous baseline after adding process smoke coverage.
```

- [ ] **Step 5: Commit**

```bash
git add docs/agent/plans/2026-03-30-v2-test-architecture.md
git commit -m "docs: record v2 test architecture execution results"
```
