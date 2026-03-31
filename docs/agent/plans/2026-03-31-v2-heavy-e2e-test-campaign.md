# Slack Codex Router v2 Heavy E2E Test Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current optimistic `v2` test confidence story with genuinely heavy deterministic end-to-end scenarios, plus an optional live-Codex realism lane, and fix production bugs surfaced by those tests.

**Architecture:** Keep `npm --prefix v2 test` as the fast localization layer, but move the real confidence bar into an expanded `test:real-integration` suite built on real SQLite state, real git/worktrees, real child processes, restart generations, and long scenario tests. Add a separate env-gated `test:live-codex` lane for worker/judge realism without contaminating the deterministic gate.

**Tech Stack:** TypeScript, Vitest, Node.js child processes, SQLite via `better-sqlite3`, git CLI, mocked Slack transport, Codex CLI for optional live tests

---

## File Structure

- Modify: `v2/package.json`
- Modify: `v2/package-lock.json`
- Create: `v2/vitest.live-codex.config.ts`
- Modify: `v2/test/helpers/real_app_server_harness.ts`
- Modify: `v2/test/helpers/git_repo_fixture.ts`
- Create: `v2/test/helpers/merge_workflow_fixture.ts`
- Create: `v2/test/helpers/live_codex_harness.ts`
- Create: `v2/test/helpers/live_codex_artifacts.ts`
- Modify: `v2/test/fixtures/app_server_stub.mjs`
- Create: `v2/test/fixtures/live_codex_worker_prompt.md`
- Create: `v2/test/fixtures/live_codex_judge_prompt.md`
- Create: `v2/test/real_integration/router_toy_app_build_scenario.test.ts`
- Create: `v2/test/real_integration/router_real_transport_torture.test.ts`
- Create: `v2/test/real_integration/router_real_toy_app_restart.test.ts`
- Modify: `v2/test/real_integration/router_real_merge_flow.test.ts`
- Create: `v2/test/real_integration/router_real_merge_replay_and_missing_path.test.ts`
- Modify: `v2/test/real_integration/router_restart_real_app_server.test.ts`
- Modify: `v2/test/helpers/launcher_fixture.ts`
- Modify: `v2/test/real_integration/launcher_restart_loop.test.ts`
- Create: `v2/test/live_codex/router_live_codex_toy_app.test.ts`
- Modify if tests expose bugs: `v2/src/router/service.ts`
- Modify if tests expose bugs: `v2/src/worktree/manager.ts`
- Modify if tests expose bugs: `v2/src/app_server/client.ts`
- Modify if tests expose bugs: `v2/src/router/runtime.ts`

## Delegation Map

- Sub-leader A owns deterministic multi-round scenario infrastructure and the toy-app build scenario.
- Sub-leader B owns real git/worktree/merge scenario expansion.
- Sub-leader C owns child-process torture, restart, and launcher generation scenarios.
- Sub-leader D owns the optional live-Codex lane.
- The controller owns integration, review routing, bug synthesis, plan updates, and final verification.

### Task 1: Add a Separate Live-Codex Test Lane

**Files:**
- Modify: `v2/package.json`
- Modify: `v2/package-lock.json`
- Create: `v2/vitest.live-codex.config.ts`

- [ ] **Step 1: Write the failing test command expectation into the plan and confirm the script does not exist yet**

```bash
npm --prefix v2 run test:live-codex
```

Expected: FAIL with `Missing script: "test:live-codex"`.

- [ ] **Step 2: Add the env-gated suite target and isolated Vitest config**

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/bin/router.ts",
    "test": "vitest run --config vitest.fast.config.ts",
    "coverage": "vitest run --config vitest.fast.config.ts --coverage.enabled=true --coverage.provider=v8",
    "test:real-integration": "vitest run --config vitest.real-integration.config.ts",
    "test:live-codex": "vitest run --config vitest.live-codex.config.ts"
  }
}
```

```ts
// v2/vitest.live-codex.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/live_codex/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Refresh package metadata**

Run: `npm --prefix v2 install`
Expected: PASS

- [ ] **Step 4: Verify the new lane resolves its directory without polluting the deterministic suites**

Run: `npm --prefix v2 run test:live-codex`
Expected: FAIL with `No test files found` until Task 7 lands.

- [ ] **Step 5: Commit**

```bash
git add v2/package.json v2/package-lock.json v2/vitest.live-codex.config.ts
git commit -m "test: add live codex suite target"
```

### Task 2: Upgrade the Real App-Server Harness for Real Repos and Multi-Round Scenarios

**Files:**
- Modify: `v2/test/helpers/real_app_server_harness.ts`
- Modify: `v2/test/fixtures/app_server_stub.mjs`
- Modify: `v2/test/helpers/git_repo_fixture.ts`

- [ ] **Step 1: Add a failing deterministic scenario test that requires real file edits after `requestUserInput`**

```ts
// v2/test/real_integration/router_toy_app_build_scenario.test.ts
it("builds a toy app across multiple rounds and writes real files after a choice action", async () => {
  const harness = await createRealAppServerHarness({
    scenario: "toy-app-build",
    useRealGitRepo: true,
  });

  try {
    await harness.dispatchTopLevelMessage({
      user: "U123",
      channel: "C08TEMPLATE",
      ts: "1710000000.0100",
      text: "Build a toy app",
    });

    await harness.waitForThreadState("awaiting_user_input");
    await harness.dispatchChoiceAction("approve-build", "Approve", "1710000000.0100");
    await harness.waitForThreadState("idle");

    expect(await harness.readProjectFile("src/app.txt")).toContain("toy app ready");
  } finally {
    await harness.cleanup();
  }
});
```

- [ ] **Step 2: Run the new test to verify the current harness is not heavy enough**

Run: `npm --prefix v2 test -- test/real_integration/router_toy_app_build_scenario.test.ts`
Expected: FAIL because the current harness fakes worktrees with `mkdirSync()` and the stub cannot yet drive a real multi-round repo-backed scenario.

- [ ] **Step 3: Extend the git fixture so the harness can boot against a real repo and expose reusable file/worktree helpers**

```ts
// v2/test/helpers/git_repo_fixture.ts
export async function createGitRepoFixture(options: GitRepoFixtureOptions = {}) {
  // existing setup ...

  return {
    // existing fields ...
    async seedAppFile(relativePath: string, contents: string, message: string) {
      writeFileSync(join(repoPath, relativePath), contents, "utf8");
      await execFileAsync("git", ["add", relativePath], { cwd: repoPath });
      await execFileAsync("git", ["commit", "-m", message], { cwd: repoPath });
    },
    async diffFromHead(cwd: string) {
      const result = await execFileAsync("git", ["diff", "--stat", "HEAD"], { cwd });
      return result.stdout.trim();
    },
    createWorktreeManager() {
      return new WorktreeManager({
        pathExists: existsSync,
        run: async ({ args, cwd }) => {
          await execFileAsync("git", args, { cwd });
        },
      });
    },
  };
}
```

- [ ] **Step 4: Replace the stub and harness happy-path shortcuts with a real scenario state machine**

```ts
// v2/test/helpers/real_app_server_harness.ts
const repo = options.useRealGitRepo ? await createGitRepoFixture() : null;
const projectDir = repo?.repoPath ?? project.projectDir;

ensureThreadWorktree: async ({ repoPath, slackThreadTs, baseBranch }) => {
  if (!repo) {
    const worktreePath = buildWorktreePath(repoPath, slackThreadTs);
    mkdirSync(worktreePath, { recursive: true });
    return { worktreePath, branchName: buildBranchName(slackThreadTs) };
  }

  return repo.createWorktreeManager().ensureThreadWorktree({
    repoPath,
    slackThreadTs,
    baseBranch,
  });
},
```

```js
// v2/test/fixtures/app_server_stub.mjs
if (scenario === "toy-app-build" && request.method === "turn/start") {
  if (scenarioState.step === 0) {
    scenarioState.step = 1;
    writeJson({ id: request.id, result: { turn: { id: "turn_toy_1" } } });
    writeJson({
      method: "tool/requestUserInput",
      params: {
        threadId,
        questions: [
          {
            id: "approve-build",
            header: "Confirm build",
            question: "Create the toy app files?",
            options: [{ label: "Approve" }, { label: "Reject" }],
          },
        ],
      },
    });
    return;
  }

  if (scenarioState.step === 1) {
    scenarioState.step = 2;
    writeProjectFile("src/app.txt", "toy app ready\n");
    writeJson({ id: request.id, result: { turn: { id: "turn_toy_2" } } });
    writeJson({ method: "thread/status/changed", params: { threadId, state: "idle" } });
    return;
  }
}
```

- [ ] **Step 5: Re-run the targeted test and commit**

Run: `npm --prefix v2 test -- test/real_integration/router_toy_app_build_scenario.test.ts`
Expected: PASS

```bash
git add v2/test/helpers/real_app_server_harness.ts v2/test/helpers/git_repo_fixture.ts v2/test/fixtures/app_server_stub.mjs v2/test/real_integration/router_toy_app_build_scenario.test.ts
git commit -m "test: add real multi-round toy app scenario harness"
```

### Task 3: Add Deterministic Heavy Toy-App Scenarios for Replay, User Input, and Store Coherence

**Files:**
- Create: `v2/test/real_integration/router_toy_app_build_scenario.test.ts`
- Modify: `v2/test/helpers/real_app_server_harness.ts`

- [ ] **Step 1: Add failing subcases for replay and stale-action safety**

```ts
it("rejects replayed choice actions after the scenario has already completed", async () => {
  const harness = await createRealAppServerHarness({
    scenario: "toy-app-build",
    useRealGitRepo: true,
  });

  try {
    await harness.dispatchTopLevelMessage({
      user: "U123",
      channel: "C08TEMPLATE",
      ts: "1710000000.0101",
      text: "Build a toy app",
    });
    await harness.waitForThreadState("awaiting_user_input");
    await harness.dispatchChoiceAction("approve-build", "Approve", "1710000000.0101");
    await harness.waitForThreadState("idle");

    await harness.dispatchChoiceAction("approve-build", "Approve", "1710000000.0101");

    expect(harness.latestSlackText()).toContain("new message");
    expect(harness.store.getThread("C08TEMPLATE", "1710000000.0101")).toMatchObject({
      state: "idle",
      appServerSessionStale: false,
    });
  } finally {
    await harness.cleanup();
  }
});
```

- [ ] **Step 2: Run the scenario file to verify the replay gaps**

Run: `npm --prefix v2 run test:real-integration -- test/real_integration/router_toy_app_build_scenario.test.ts`
Expected: FAIL because the current harness does not yet expose enough action/state observability or the production code mishandles the replay.

- [ ] **Step 3: Add the harness observability needed to prove transcript, state, and filesystem outcomes**

```ts
// v2/test/helpers/real_app_server_harness.ts
async function waitForThreadState(expectedState: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const thread = store.getThread("C08TEMPLATE", currentThreadTs);
    if (thread?.state === expectedState) {
      return;
    }
    await delay(10);
  }
  throw new Error(`Timed out waiting for thread state ${expectedState}`);
}

async function readProjectFile(relativePath: string): Promise<string> {
  return readFileSync(join(projectDir, relativePath), "utf8");
}
```

- [ ] **Step 4: If the replay test exposes a production bug, make the minimal fix in `RouterService` before broadening the suite**

```ts
// v2/src/router/service.ts
if (
  expectedSelection &&
  (expectedSelection.sourceBranch !== thread.branchName ||
    expectedSelection.targetBranch !== thread.baseBranch)
) {
  throw new Error("Merge confirmation is stale. Request a fresh merge preview.");
}
```

Also apply the equivalent stale-check discipline to resumed user-input actions if the heavy scenario exposes a missing guard.

- [ ] **Step 5: Re-run the scenario file and commit**

Run: `npm --prefix v2 run test:real-integration -- test/real_integration/router_toy_app_build_scenario.test.ts`
Expected: PASS

```bash
git add v2/test/helpers/real_app_server_harness.ts v2/test/real_integration/router_toy_app_build_scenario.test.ts v2/src/router/service.ts
git commit -m "test: harden toy app scenario replay behavior"
```

### Task 4: Expand Real Merge and Worktree Scenarios Beyond the Happy Path

**Files:**
- Modify: `v2/test/helpers/git_repo_fixture.ts`
- Create: `v2/test/helpers/merge_workflow_fixture.ts`
- Modify: `v2/test/real_integration/router_real_merge_flow.test.ts`
- Create: `v2/test/real_integration/router_real_merge_replay_and_missing_path.test.ts`
- Modify if needed: `v2/src/worktree/manager.ts`
- Modify if needed: `v2/src/router/service.ts`

- [ ] **Step 1: Add failing merge-flow tests for stale confirmation, missing worktree path, and conflict cases**

```ts
// v2/test/real_integration/router_real_merge_replay_and_missing_path.test.ts
it("rejects a replayed merge confirmation after the thread has already returned to the base branch", async () => {
  const fixture = await createMergeWorkflowFixture();

  try {
    await fixture.seedCompletedWorktreeChange("1710000000.0200");
    await fixture.service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0200");

    await expect(
      fixture.service.confirmMergeToMain("U123", "C08TEMPLATE", "1710000000.0200", {
        sourceBranch: fixture.worktree.branchName,
        targetBranch: fixture.repo.defaultBranch,
      }),
    ).rejects.toThrow("Merge confirmation is stale");
  } finally {
    await fixture.cleanup();
  }
});
```

- [ ] **Step 2: Run the merge real-integration tests to verify gaps**

Run: `npm --prefix v2 run test:real-integration -- test/real_integration/router_real_merge_flow.test.ts test/real_integration/router_real_merge_replay_and_missing_path.test.ts`
Expected: FAIL on at least one of stale replay, wrong-branch reuse, or missing-path handling.

- [ ] **Step 3: Add a merge workflow helper so Lane B can keep Slack/router-store assertions separate from Lane A**

```ts
// v2/test/helpers/merge_workflow_fixture.ts
export async function createMergeWorkflowFixture() {
  const repo = await createGitRepoFixture({ divergedBranch: "feature/merge-heavy" });
  const store = new RouterStore(":memory:");
  const worktree = await repo.createWorktreeManager().ensureThreadWorktree({
    repoPath: repo.repoPath,
    slackThreadTs: "1710000000.0200",
    baseBranch: repo.defaultBranch,
  });

  return {
    repo,
    store,
    worktree,
    async cleanup() {
      store.close();
      repo.cleanup();
    },
  };
}
```

- [ ] **Step 4: Fix any real defects surfaced by the new tests before broadening the assertions**

```ts
// v2/src/worktree/manager.ts
if (!this.pathExists(worktreePath)) {
  await this.run({
    args: ["worktree", "add", "-b", branchName, worktreePath, input.baseBranch],
    cwd: input.repoPath,
  });
}
```

If the failure shows stale-path reuse or wrong-branch reuse, tighten this code to verify the resulting worktree is actually on `branchName` before treating a concurrent-add error as success.

- [ ] **Step 5: Re-run the merge suite and commit**

Run: `npm --prefix v2 run test:real-integration -- test/real_integration/router_real_merge_flow.test.ts test/real_integration/router_real_merge_replay_and_missing_path.test.ts`
Expected: PASS

```bash
git add v2/test/helpers/git_repo_fixture.ts v2/test/helpers/merge_workflow_fixture.ts v2/test/real_integration/router_real_merge_flow.test.ts v2/test/real_integration/router_real_merge_replay_and_missing_path.test.ts v2/src/worktree/manager.ts v2/src/router/service.ts
git commit -m "test: expand real merge and worktree scenarios"
```

### Task 5: Add Child-Process Transport Torture Scenarios

**Files:**
- Modify: `v2/test/fixtures/app_server_stub.mjs`
- Modify: `v2/test/helpers/real_app_server_harness.ts`
- Create: `v2/test/real_integration/router_real_transport_torture.test.ts`
- Modify if needed: `v2/src/app_server/client.ts`
- Modify if needed: `v2/src/router/runtime.ts`

- [ ] **Step 1: Add failing torture tests for late notifications, stderr noise, and outstanding-request death**

```ts
// v2/test/real_integration/router_real_transport_torture.test.ts
it("keeps state coherent when the child emits fragmented output, stderr noise, and then exits during an outstanding request", async () => {
  const harness = await createRealAppServerHarness({
    scenario: "transport-torture",
    persistentStore: true,
    useRealGitRepo: true,
  });

  try {
    await expect(
      harness.dispatchTopLevelMessage({
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0300",
        text: "Build a toy app",
      }),
    ).rejects.toThrow();

    expect(harness.processExitCodes.length).toBeGreaterThan(0);
    expect(harness.store.getThread("C08TEMPLATE", "1710000000.0300")).toMatchObject({
      state: expect.stringMatching(/failed_setup|interrupted/),
    });
  } finally {
    await harness.cleanup();
  }
});
```

- [ ] **Step 2: Run the torture file to pin the current failure mode**

Run: `npm --prefix v2 run test:real-integration -- test/real_integration/router_real_transport_torture.test.ts`
Expected: FAIL because the current stub and harness do not yet combine those failure modes in one scenario.

- [ ] **Step 3: Add the combined transport-torture mode and richer artifact capture**

```js
// v2/test/fixtures/app_server_stub.mjs
if (scenario === "transport-torture") {
  process.stderr.write("stub: noise before failure\\n");
  writeRaw(`${JSON.stringify({ id: request.id, result: { turn: { id: "turn_noise" } } }).slice(0, 15)}`);
  writeRaw(`${JSON.stringify({ id: request.id, result: { turn: { id: "turn_noise" } } }).slice(15)}\n`);
  writeJson({ method: "thread/status/changed", params: { threadId, state: "running" } });
  writeJson({ method: "item/completed", params: { threadId, item: { type: "agentMessage", text: "partial", phase: "commentary" } } });
  process.exit(23);
}
```

```ts
// v2/test/helpers/real_app_server_harness.ts
readArtifacts(): Array<Record<string, unknown>> {
  return existsSync(artifactLogPath) ? readRequests(artifactLogPath) : [];
}
```

- [ ] **Step 4: If the new test exposes lost-correlation or shutdown-order bugs, apply the minimal fix**

```ts
// v2/src/app_server/client.ts
const pendingRequest = this.pendingRequests.get(message.response.id);
if (!pendingRequest) {
  return;
}
```

If the test shows that silent drops hide real races, add structured diagnostics or fail-fast behavior without breaking the normal notification path.

- [ ] **Step 5: Re-run the torture suite and commit**

Run: `npm --prefix v2 run test:real-integration -- test/real_integration/router_real_transport_torture.test.ts`
Expected: PASS

```bash
git add v2/test/fixtures/app_server_stub.mjs v2/test/helpers/real_app_server_harness.ts v2/test/real_integration/router_real_transport_torture.test.ts v2/src/app_server/client.ts v2/src/router/runtime.ts
git commit -m "test: add app server transport torture scenarios"
```

### Task 6: Prove Restart Survival Across Multiple Generations

**Files:**
- Create: `v2/test/real_integration/router_real_toy_app_restart.test.ts`
- Modify: `v2/test/real_integration/router_restart_real_app_server.test.ts`
- Modify: `v2/test/helpers/launcher_fixture.ts`
- Modify: `v2/test/real_integration/launcher_restart_loop.test.ts`
- Modify if needed: `v2/src/runtime/restart.ts`

- [ ] **Step 1: Add failing restart scenarios for multi-round build continuation and repeated launcher generations**

```ts
// v2/test/real_integration/router_real_toy_app_restart.test.ts
it("continues a toy-app build after restart and rejects stale controls from the pre-restart generation", async () => {
  const harness = await createRealAppServerHarness({
    scenario: "toy-app-build",
    persistentStore: true,
    useRealGitRepo: true,
  });

  try {
    await harness.dispatchTopLevelMessage({
      user: "U123",
      channel: "C08TEMPLATE",
      ts: "1710000000.0400",
      text: "Build a toy app",
    });
    await harness.waitForThreadState("awaiting_user_input");
    await harness.dispatchAction("restart_router", {
      user: { id: "U123" },
      channel: { id: "C08TEMPLATE" },
      message: { thread_ts: "1710000000.0400" },
    });
    await harness.bootNextGeneration();
    await harness.dispatchChoiceAction("approve-build", "Approve", "1710000000.0400");

    expect(harness.latestSlackText()).toContain("new message");
  } finally {
    await harness.cleanup();
  }
});
```

```ts
// v2/test/real_integration/launcher_restart_loop.test.ts
it("restarts through more than one generation when the worker exits with 75 repeatedly", async () => {
  const fixture = await createLauncherFixture({ exitCodes: [75, 75, 0] });
  // existing spawn logic ...
  expect(await fixture.observedExitCodes()).toEqual([75, 75, 0]);
});
```

- [ ] **Step 2: Run the restart-focused suite to verify current limitations**

Run: `npm --prefix v2 run test:real-integration -- test/real_integration/router_restart_real_app_server.test.ts test/real_integration/router_real_toy_app_restart.test.ts test/real_integration/launcher_restart_loop.test.ts`
Expected: FAIL because the current launcher fixture only models one restart and the real harness does not yet support longer toy-app continuity after reboot.

- [ ] **Step 3: Extend the launcher fixture and restart harness for repeated generations**

```ts
// v2/test/helpers/launcher_fixture.ts
export async function createLauncherFixture(options: { exitCodes?: number[] } = {}) {
  const exitCodes = options.exitCodes ?? [75, 0];
  // write a worker script that chooses process.exit(exitCodes[generation - 1] ?? 0)
}
```

```ts
// v2/test/real_integration/router_restart_real_app_server.test.ts
// Narrow this file to pure restart-rebind semantics once the broader toy-app restart flow exists.
```

- [ ] **Step 4: Fix restart-recovery defects only if the new heavy scenario exposes them**

```ts
// v2/src/runtime/restart.ts
const recoveredThreads: ThreadRecord[] = input.recoverableThreads.map((thread) => ({
  ...thread,
  activeTurnId: null,
  appServerSessionStale: true,
  state: thread.state === "idle" ? "idle" : "interrupted",
}));
```

If multiple restart requests or stale-action semantics go red, tighten the mapping or restart-intent handling here instead of papering over it in tests.

- [ ] **Step 5: Re-run the restart suite and commit**

Run: `npm --prefix v2 run test:real-integration -- test/real_integration/router_restart_real_app_server.test.ts test/real_integration/router_real_toy_app_restart.test.ts test/real_integration/launcher_restart_loop.test.ts`
Expected: PASS

```bash
git add v2/test/helpers/launcher_fixture.ts v2/test/real_integration/launcher_restart_loop.test.ts v2/test/real_integration/router_restart_real_app_server.test.ts v2/test/real_integration/router_real_toy_app_restart.test.ts v2/src/runtime/restart.ts
git commit -m "test: prove restart survival across generations"
```

### Task 7: Add the Optional Live-Codex Worker/Judge Scenario

**Files:**
- Create: `v2/test/helpers/live_codex_harness.ts`
- Create: `v2/test/helpers/live_codex_artifacts.ts`
- Create: `v2/test/fixtures/live_codex_worker_prompt.md`
- Create: `v2/test/fixtures/live_codex_judge_prompt.md`
- Create: `v2/test/live_codex/router_live_codex_toy_app.test.ts`

- [ ] **Step 1: Write the env-gated live test skeleton so the command is real but safely skippable**

```ts
// v2/test/live_codex/router_live_codex_toy_app.test.ts
import { describe, expect, it } from "vitest";

const liveCodexEnabled =
  process.env.LIVE_CODEX_E2E === "1" &&
  typeof process.env.CODEX_BIN === "string" &&
  process.env.CODEX_BIN.length > 0;

describe("live codex toy app scenario", () => {
  it.skipIf(!liveCodexEnabled)(
    "routes a toy-app task to a live Codex worker and evaluates the result with a live Codex judge",
    async () => {
      const harness = await createLiveCodexHarness();
      const result = await harness.runToyAppScenario();

      expect(result.objectiveChecks.passed).toBe(true);
      expect(result.judgeVerdict.status).toBe("pass");
    },
    300000,
  );
});
```

- [ ] **Step 2: Run the lane to verify it skips cleanly when env is absent**

Run: `npm --prefix v2 run test:live-codex`
Expected: PASS with skipped tests when `LIVE_CODEX_E2E` and `CODEX_BIN` are unset.

- [ ] **Step 3: Add the live harness, artifact serializer, and rubric-bound prompts**

```ts
// v2/test/helpers/live_codex_artifacts.ts
export function buildJudgeArtifactBundle(input: {
  transcript: Array<Record<string, unknown>>;
  finalFiles: Array<{ path: string; contents: string }>;
  gitDiff: string;
  rubric: Record<string, unknown>;
}) {
  return JSON.stringify(input, null, 2);
}
```

```md
<!-- v2/test/fixtures/live_codex_judge_prompt.md -->
Decide pass or fail using only the supplied artifact bundle.
You must cite:
1. whether the toy app files were created,
2. whether the Slack transcript shows a coherent multi-round interaction,
3. whether the git diff matches the requested task.
Return strict JSON: {"status":"pass|fail","reasons":["..."]}.
```

- [ ] **Step 4: Add the harness that captures objective evidence separately from the judge verdict**

```ts
// v2/test/helpers/live_codex_harness.ts
export async function createLiveCodexHarness() {
  return {
    async runToyAppScenario() {
      return {
        objectiveChecks: { passed: true },
        judgeVerdict: { status: "pass", reasons: [] as string[] },
      };
    },
  };
}
```

Replace the stubbed return values with real mocked-Slack transcript capture, temp-repo file capture, `git diff`, worker stdout/stderr, and judge stdout/stderr before considering the task complete.

- [ ] **Step 5: Commit**

```bash
git add v2/test/helpers/live_codex_harness.ts v2/test/helpers/live_codex_artifacts.ts v2/test/fixtures/live_codex_worker_prompt.md v2/test/fixtures/live_codex_judge_prompt.md v2/test/live_codex/router_live_codex_toy_app.test.ts
git commit -m "test: add optional live codex worker judge scenario"
```

### Task 8: Run the Full Verification Bar and Document Surfaced Production Bugs

**Files:**
- Modify if needed: `docs/agent/plans/2026-03-31-v2-heavy-e2e-test-campaign.md`

- [ ] **Step 1: Run the fast suite**

Run: `npm --prefix v2 test`
Expected: PASS

- [ ] **Step 2: Run coverage**

Run: `npm --prefix v2 run coverage`
Expected: PASS

- [ ] **Step 3: Run the deterministic heavy real-integration suite**

Run: `npm --prefix v2 run test:real-integration`
Expected: PASS

- [ ] **Step 4: Run the optional live-Codex lane if env is configured**

Run: `LIVE_CODEX_E2E=1 CODEX_BIN=/path/to/codex npm --prefix v2 run test:live-codex`
Expected: PASS or a documented env/setup blocker; this lane must not break the deterministic suites.

- [ ] **Step 5: Update this plan with observed outcomes and commit the final verification state**

```bash
git add docs/agent/plans/2026-03-31-v2-heavy-e2e-test-campaign.md
git commit -m "docs: record heavy e2e campaign execution"
```
