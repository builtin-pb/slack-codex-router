# Slack Codex Router v2 Heavy E2E Test Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing `v2` suite into a credible confidence gate by adding deterministic heavy end-to-end scenarios, restart/process torture coverage, real merge/worktree workflows, and an optional live-Codex realism path.

**Architecture:** Reuse the existing real child-process and real git fixtures, but extend them into a scenario runner that can perform multi-round scripted workflows over the real router/runtime stack. Keep deterministic heavy tests in `test:real-integration`, use the fast suite only for state-machine localization, and place live-Codex worker/judge scenarios behind a separate opt-in command.

**Tech Stack:** TypeScript, Vitest, Node child processes, SQLite via `better-sqlite3`, git CLI, existing `v2` router/runtime/test helpers

---

## File Structure

- Modify: `v2/test/fixtures/app_server_stub.mjs`
  - Extend the child-process stub from narrow request/response samples into a scenario engine that can emit multi-round notifications, request user input, write project files, fragment/coalesce stdout, and exit during configured steps.
- Modify: `v2/test/helpers/real_app_server_harness.ts`
  - Add scenario controls for waiting on transcripts, filesystem effects, restart generations, replaying messages/actions, and objective scenario completion assertions.
- Modify: `v2/test/helpers/git_repo_fixture.ts`
  - Add helpers for seeding realistic app repos, forcing conflicts, reading diffs, and asserting merged outcomes.
- Create: `v2/test/helpers/real_scenario_fixture.ts`
  - Centralize heavy-scenario setup so the same temp project, store, repo, and artifact capture can be reused across multiple real-integration files.
- Create: `v2/test/real_integration/router_real_toy_app_flow.test.ts`
  - Anchor deterministic multi-round toy-app build, duplicate delivery, stale action, and replay safety scenarios.
- Create: `v2/test/real_integration/router_real_toy_app_restart.test.ts`
  - Cover restart-in-the-middle build behavior, stale-session rebind, and continuation after restart.
- Modify: `v2/test/real_integration/router_real_merge_flow.test.ts`
  - Upgrade isolated merge tests into broader real workflow tests tied to the toy-app scenario and negative merge paths.
- Create: `v2/test/real_integration/router_real_transport_torture.test.ts`
  - Cover fragmented/coalesced stdout, stderr noise, exit-during-request, and late notification behavior in one place.
- Modify: `v2/test/real_integration/router_restart_real_app_server.test.ts`
  - Keep the current restart seam tests, but narrow them to bootstrap-specific checks once broader scenario coverage lands.
- Modify: `v2/package.json`
  - Add any new commands for the optional live-Codex smoke path.
- Create: `v2/test/live_codex/live_codex_smoke.test.ts`
  - Env-gated realism scenario with a live Codex worker and a separate evidence-bound live Codex judge.
- Create: `v2/test/live_codex/judge_rubric.md`
  - Fixed rubric used by the live judge so pass/fail is constrained by evidence rather than free-form opinion.
- Modify: `README.md`
  - Document the new deterministic heavy suite and the optional live-Codex workflow.

### Task 1: Build a reusable real-scenario engine for multi-round flows

**Files:**
- Modify: `v2/test/fixtures/app_server_stub.mjs`
- Modify: `v2/test/helpers/real_app_server_harness.ts`
- Create: `v2/test/helpers/real_scenario_fixture.ts`
- Test: `v2/test/real_integration/router_real_toy_app_flow.test.ts`

- [ ] **Step 1: Write the failing toy-app happy-path test first**

```ts
// v2/test/real_integration/router_real_toy_app_flow.test.ts
import { describe, expect, it } from "vitest";
import { createRealScenarioFixture } from "../helpers/real_scenario_fixture.js";

describe("deterministic toy-app build scenario", () => {
  it("builds a toy app across multiple rounds with a real router, real child process, and real file edits", async () => {
    const fixture = await createRealScenarioFixture({
      scenario: "toy-app-build",
    });

    try {
      await fixture.dispatchTopLevelMessage({
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0100",
        text: "Build a tiny toy app",
      });

      await fixture.waitForScenarioPause("awaiting-user-input");
      await fixture.dispatchChoice("Approve");
      await fixture.waitForScenarioCompletion();

      expect(await fixture.readProjectFile("src/app.txt")).toContain("toy app ready");
      expect(fixture.store.getThread("C08TEMPLATE", "1710000000.0100")).toMatchObject({
        state: "idle",
        appServerSessionStale: false,
      });
      expect(fixture.transcript()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "slack-message" }),
          expect.objectContaining({ kind: "request-user-input" }),
          expect.objectContaining({ kind: "file-write", path: "src/app.txt" }),
        ]),
      );
    } finally {
      await fixture.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run the new real-integration test and verify it fails because the scenario fixture does not exist yet**

Run: `npm --prefix v2 run test:real-integration -- router_real_toy_app_flow.test.ts`
Expected: FAIL with module-not-found or missing-export errors for `createRealScenarioFixture`, plus missing `"toy-app-build"` scenario support.

- [ ] **Step 3: Extend the child-process stub into a scenario engine**

```js
// v2/test/fixtures/app_server_stub.mjs
const scenario = process.env.APP_SERVER_STUB_SCENARIO ?? "happy-path";
const projectRoot = process.env.APP_SERVER_STUB_PROJECT_ROOT;

const scenarioState = {
  step: 0,
  pendingChoice: null,
};

function writeProjectFile(relativePath, contents) {
  mkdirSync(dirname(join(projectRoot, relativePath)), { recursive: true });
  writeFileSync(join(projectRoot, relativePath), contents, "utf8");
  emitArtifact({ kind: "file-write", path: relativePath, contents });
}

function handleToyAppBuild(request) {
  if (request.method === "turn/start" && scenarioState.step === 0) {
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

  if (request.method === "turn/start" && scenarioState.step === 1) {
    scenarioState.step = 2;
    writeProjectFile("src/app.txt", "toy app ready\n");
    writeJson({ id: request.id, result: { turn: { id: "turn_toy_2" } } });
    writeJson({ method: "thread/status/changed", params: { threadId, state: "idle" } });
    return;
  }
}
```

- [ ] **Step 4: Add a scenario fixture that wraps the real harness with project-artifact assertions**

```ts
// v2/test/helpers/real_scenario_fixture.ts
export async function createRealScenarioFixture(options: {
  scenario: "toy-app-build";
}) {
  const harness = await createRealAppServerHarness({
    scenario: options.scenario,
    persistentStore: true,
  });

  return {
    ...harness,
    async dispatchChoice(choice: string) {
      await harness.dispatchAction("codex_choice:approve-build-1", {
        action: {
          action_id: "codex_choice:approve-build-1",
          value: choice,
        },
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0100" },
      });
    },
    async waitForScenarioPause(expectedState: "awaiting-user-input") {
      await waitFor(() => {
        const thread = harness.store.getThread("C08TEMPLATE", "1710000000.0100");
        return thread?.state === "awaiting_user_input";
      });
    },
    async waitForScenarioCompletion() {
      await waitFor(() => {
        const thread = harness.store.getThread("C08TEMPLATE", "1710000000.0100");
        return thread?.state === "idle";
      });
    },
  };
}
```

- [ ] **Step 5: Run the targeted real-integration test and make it pass**

Run: `npm --prefix v2 run test:real-integration -- router_real_toy_app_flow.test.ts`
Expected: PASS with the new multi-round deterministic toy-app scenario.

- [ ] **Step 6: Commit the scenario-engine slice**

```bash
git add v2/test/fixtures/app_server_stub.mjs \
  v2/test/helpers/real_app_server_harness.ts \
  v2/test/helpers/real_scenario_fixture.ts \
  v2/test/real_integration/router_real_toy_app_flow.test.ts
git commit -m "test: add real toy app scenario engine"
```

### Task 2: Add replay, duplicate-delivery, and stale-control heavy scenarios

**Files:**
- Modify: `v2/test/helpers/real_scenario_fixture.ts`
- Modify: `v2/test/real_integration/router_real_toy_app_flow.test.ts`
- Test: `v2/test/real_integration/router_real_toy_app_flow.test.ts`

- [ ] **Step 1: Add failing duplicate and stale-action tests**

```ts
it("rejects replayed choice actions and duplicate top-level deliveries without duplicate work", async () => {
  const fixture = await createRealScenarioFixture({ scenario: "toy-app-build" });

  try {
    await fixture.dispatchTopLevelMessage({
      user: "U123",
      channel: "C08TEMPLATE",
      ts: "1710000000.0101",
      text: "Build a tiny toy app",
    });

    await fixture.dispatchTopLevelMessage({
      user: "U123",
      channel: "C08TEMPLATE",
      ts: "1710000000.0101",
      text: "Build a tiny toy app",
    });

    await fixture.waitForScenarioPause("awaiting-user-input");
    await fixture.dispatchChoice("Approve");
    await fixture.waitForScenarioCompletion();

    await fixture.dispatchChoice("Approve");

    expect(fixture.countRequests("thread/start")).toBe(1);
    expect(fixture.countArtifact("file-write", "src/app.txt")).toBe(1);
    expect(fixture.lastSlackMessage()).toMatchObject({
      text: expect.stringContaining("fresh"),
    });
  } finally {
    await fixture.cleanup();
  }
});
```

- [ ] **Step 2: Run the duplicate/replay tests and verify they fail before fixture or production changes**

Run: `npm --prefix v2 run test:real-integration -- router_real_toy_app_flow.test.ts`
Expected: FAIL because duplicate delivery and replay counting/assertion helpers do not exist yet, and production state handling may still double-start or accept stale actions.

- [ ] **Step 3: Extend the fixture with request counting, artifact counting, and stale-action helpers**

```ts
// v2/test/helpers/real_scenario_fixture.ts
countRequests(method: string): number {
  return this.requests().filter((request) => request.method === method).length;
},
countArtifact(kind: string, path: string): number {
  return this.transcript().filter((event) => event.kind === kind && event.path === path).length;
},
lastSlackMessage() {
  return this.slack.postedMessages.at(-1);
},
```

- [ ] **Step 4: Fix any production bugs surfaced by the scenario**

```ts
// v2/src/router/service.ts
if (existingThread.state === "running") {
  await input.reply(renderRunningTurn());
  return;
}

if (thread.appServerSessionStale) {
  throw new Error("This control is stale. Send a fresh Slack message to continue.");
}
```

Implement only the minimal production fix needed for the failing heavy test. If the bug lands elsewhere, patch that module instead of forcing it into `RouterService`.

- [ ] **Step 5: Re-run the targeted heavy scenario test**

Run: `npm --prefix v2 run test:real-integration -- router_real_toy_app_flow.test.ts`
Expected: PASS with duplicate top-level delivery blocked and stale replayed controls rejected without duplicate file writes.

- [ ] **Step 6: Commit the replay-safety slice**

```bash
git add v2/test/helpers/real_scenario_fixture.ts \
  v2/test/real_integration/router_real_toy_app_flow.test.ts \
  v2/src/router/service.ts
git commit -m "test: cover replay and stale control safety"
```

### Task 3: Add restart-in-the-middle build coverage and process torture scenarios

**Files:**
- Modify: `v2/test/helpers/real_app_server_harness.ts`
- Modify: `v2/test/fixtures/app_server_stub.mjs`
- Create: `v2/test/real_integration/router_real_toy_app_restart.test.ts`
- Create: `v2/test/real_integration/router_real_transport_torture.test.ts`
- Modify: `v2/test/real_integration/router_restart_real_app_server.test.ts`
- Test: `v2/test/real_integration/router_real_toy_app_restart.test.ts`
- Test: `v2/test/real_integration/router_real_transport_torture.test.ts`

- [ ] **Step 1: Write failing restart-during-build and transport-torture tests**

```ts
// v2/test/real_integration/router_real_toy_app_restart.test.ts
it("recovers a half-built toy app after restart and finishes on the next reply", async () => {
  const fixture = await createRealScenarioFixture({
    scenario: "toy-app-build-with-restart",
  });

  try {
    await fixture.dispatchTopLevelMessage({
      user: "U123",
      channel: "C08TEMPLATE",
      ts: "1710000000.0102",
      text: "Build a tiny toy app",
    });

    await fixture.waitForScenarioPause("awaiting-user-input");
    await fixture.requestRouterRestart();
    await fixture.bootNextGeneration();
    await fixture.dispatchThreadReply({
      user: "U123",
      channel: "C08TEMPLATE",
      ts: "1710000000.0103",
      thread_ts: "1710000000.0102",
      text: "continue",
    });
    await fixture.dispatchChoice("Approve");
    await fixture.waitForScenarioCompletion();

    expect(await fixture.readProjectFile("src/app.txt")).toContain("toy app ready");
    expect(fixture.store.getThread("C08TEMPLATE", "1710000000.0102")).toMatchObject({
      appServerSessionStale: false,
      state: "idle",
    });
  } finally {
    await fixture.cleanup();
  }
});
```

```ts
// v2/test/real_integration/router_real_transport_torture.test.ts
it("survives fragmented output, stderr noise, and child exit during an outstanding request", async () => {
  const fixture = await createRealScenarioFixture({
    scenario: "transport-torture",
  });

  try {
    await expect(
      fixture.dispatchTopLevelMessage({
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0104",
        text: "Build a tiny toy app",
      }),
    ).rejects.toThrow();

    expect(fixture.processExitCodes.length).toBeGreaterThan(0);
    expect(fixture.store.getThread("C08TEMPLATE", "1710000000.0104")).toMatchObject({
      state: expect.stringMatching(/failed_setup|interrupted/),
    });
  } finally {
    await fixture.cleanup();
  }
});
```

- [ ] **Step 2: Run the new restart and torture tests and verify they fail**

Run: `npm --prefix v2 run test:real-integration -- router_real_toy_app_restart.test.ts router_real_transport_torture.test.ts`
Expected: FAIL because the stub does not yet model restart checkpoints or transport-torture sequences, and the harness does not yet expose restart helper methods.

- [ ] **Step 3: Extend the harness and stub with restart-aware checkpoints and transport noise**

```ts
// v2/test/helpers/real_app_server_harness.ts
async requestRouterRestart() {
  await this.dispatchAction("restart_router", {
    user: { id: "U123" },
    channel: { id: "C08TEMPLATE" },
    message: { thread_ts: this.primaryThreadTs },
  });
}
```

```js
// v2/test/fixtures/app_server_stub.mjs
if (scenario === "transport-torture") {
  process.stderr.write("simulated stderr noise\n");
  writeRaw("{\"id\":1");
  writeRaw(",\"result\":{\"thread\":{\"id\":\"thread_abc\"}}}\n");
  setTimeout(() => process.exit(23), 5);
}
```

- [ ] **Step 4: Apply the minimal production fixes exposed by restart and transport scenarios**

```ts
// Example target: v2/src/router/runtime.ts
void input.appServerProcess
  .waitForExit()
  .then(() => {
    detachEventListener();
    detachLineListener();
    input.appServerClient.failPendingRequests(new Error("App Server process exited"));
  });
```

If the heavy scenario finds a rollback or stale-session bug, fix the real production module that owns it (`runtime.ts`, `service.ts`, or process/client code).

- [ ] **Step 5: Re-run the restart and torture scenario files**

Run: `npm --prefix v2 run test:real-integration -- router_real_toy_app_restart.test.ts router_real_transport_torture.test.ts`
Expected: PASS with restart continuation, stale control rejection, and controlled failure on transport death.

- [ ] **Step 6: Commit the restart/process slice**

```bash
git add v2/test/helpers/real_app_server_harness.ts \
  v2/test/fixtures/app_server_stub.mjs \
  v2/test/real_integration/router_real_toy_app_restart.test.ts \
  v2/test/real_integration/router_real_transport_torture.test.ts \
  v2/test/real_integration/router_restart_real_app_server.test.ts \
  v2/src/router/runtime.ts \
  v2/src/app_server/client.ts \
  v2/src/app_server/process.ts \
  v2/src/router/service.ts
git commit -m "test: add restart and transport torture scenarios"
```

### Task 4: Tie the toy-app scenario to real merge and worktree workflows

**Files:**
- Modify: `v2/test/helpers/git_repo_fixture.ts`
- Modify: `v2/test/helpers/real_scenario_fixture.ts`
- Modify: `v2/test/real_integration/router_real_merge_flow.test.ts`
- Test: `v2/test/real_integration/router_real_merge_flow.test.ts`

- [ ] **Step 1: Write failing merge/worktree workflow tests grounded in the toy-app scenario**

```ts
// v2/test/real_integration/router_real_merge_flow.test.ts
it("builds a toy app in a linked worktree and merges it back to main through the real action flow", async () => {
  const fixture = await createRealScenarioFixture({
    scenario: "toy-app-build",
    git: { seedRepo: true },
  });

  try {
    await fixture.runToyAppBuild("1710000000.0105");
    await fixture.dispatchMergePreview();
    await fixture.dispatchMergeConfirm();

    expect(await fixture.readRepoRootFile("src/app.txt")).toContain("toy app ready");
    expect(fixture.store.getThread("C08TEMPLATE", "1710000000.0105")).toMatchObject({
      branchName: "main",
      worktreePath: fixture.repoRootPath,
      appServerSessionStale: true,
    });
  } finally {
    await fixture.cleanup();
  }
});
```

```ts
it("does not mutate persisted state when merge confirm is stale or the worktree path is missing", async () => {
  const fixture = await createRealScenarioFixture({
    scenario: "toy-app-build",
    git: { seedRepo: true },
  });

  try {
    await fixture.runToyAppBuild("1710000000.0106");
    const before = fixture.store.getThread("C08TEMPLATE", "1710000000.0106");
    fixture.removeCurrentWorktreePath();

    await expect(fixture.dispatchMergeConfirm()).rejects.toThrow();
    expect(fixture.store.getThread("C08TEMPLATE", "1710000000.0106")).toEqual(before);
  } finally {
    await fixture.cleanup();
  }
});
```

- [ ] **Step 2: Run the real merge workflow tests and verify they fail before helper changes**

Run: `npm --prefix v2 run test:real-integration -- router_real_merge_flow.test.ts`
Expected: FAIL because the existing fixture does not bridge the toy-app scenario into the merge flow or provide repo-root assertions.

- [ ] **Step 3: Extend git and scenario helpers for realistic merge assertions**

```ts
// v2/test/helpers/git_repo_fixture.ts
async diffStat(cwd: string) {
  const result = await execFileAsync("git", ["diff", "--stat"], { cwd });
  return result.stdout.trim();
},
async createConflictOnMain(relativePath: string, contents: string) {
  writeFileSync(join(repoPath, relativePath), contents, "utf8");
  await execFileAsync("git", ["add", relativePath], { cwd: repoPath });
  await execFileAsync("git", ["commit", "-m", "conflicting main change"], { cwd: repoPath });
},
```

```ts
// v2/test/helpers/real_scenario_fixture.ts
async dispatchMergePreview() {
  await this.dispatchAction("merge_to_main", {
    user: { id: "U123" },
    channel: { id: "C08TEMPLATE" },
    message: { thread_ts: this.primaryThreadTs },
  });
},
async dispatchMergeConfirm() {
  await this.dispatchAction("confirm_merge_to_main", {
    action: {
      action_id: "confirm_merge_to_main",
      value: `${this.currentBranchName()}:main`,
    },
    user: { id: "U123" },
    channel: { id: "C08TEMPLATE" },
    message: { thread_ts: this.primaryThreadTs },
  });
},
```

- [ ] **Step 4: Fix the production merge/worktree bug exposed by the real scenario, if any**

```ts
// Example target: v2/src/router/service.ts
const mergedRepoPath = deriveRepositoryPath(thread.worktreePath);
if (mergedRepoPath !== thread.worktreePath) {
  const rootStatus = await this.options.getRepositoryStatus({
    repoPath: mergedRepoPath,
    sourceBranch: thread.branchName,
    targetBranch: thread.baseBranch,
  });
  if (rootStatus.worktreeStatus !== "clean") {
    throw new Error("The repository root checkout has uncommitted changes and cannot be merged.");
  }
}
```

Keep the fix minimal and evidence-driven.

- [ ] **Step 5: Re-run the merge/worktree workflow tests**

Run: `npm --prefix v2 run test:real-integration -- router_real_merge_flow.test.ts`
Expected: PASS with successful real merge, correct persisted-state reset, and no mutation on stale or missing-path failure.

- [ ] **Step 6: Commit the merge/worktree slice**

```bash
git add v2/test/helpers/git_repo_fixture.ts \
  v2/test/helpers/real_scenario_fixture.ts \
  v2/test/real_integration/router_real_merge_flow.test.ts \
  v2/src/router/service.ts \
  v2/src/git/merge_to_main.ts \
  v2/src/git/repository_status.ts \
  v2/src/worktree/manager.ts
git commit -m "test: add real toy app merge workflow coverage"
```

### Task 5: Add the optional live-Codex worker and judge smoke path

**Files:**
- Modify: `v2/package.json`
- Create: `v2/test/live_codex/live_codex_smoke.test.ts`
- Create: `v2/test/live_codex/judge_rubric.md`
- Modify: `README.md`
- Test: `v2/test/live_codex/live_codex_smoke.test.ts`

- [ ] **Step 1: Write the env-gated failing live-Codex smoke test**

```ts
// v2/test/live_codex/live_codex_smoke.test.ts
import { describe, expect, it } from "vitest";

const runLiveCodex = process.env.RUN_LIVE_CODEX_SMOKE === "1";

describe.runIf(runLiveCodex)("live codex smoke", () => {
  it("routes a toy-app request to a live Codex worker and evaluates the result with a live Codex judge", async () => {
    const result = await runLiveCodexSmoke({
      prompt: "Build a tiny toy app with one approval round",
      rubricPath: new URL("./judge_rubric.md", import.meta.url),
    });

    expect(result.worker.completed).toBe(true);
    expect(result.judge.verdict).toBe("pass");
    expect(result.objectiveChecks.filesCreated).toContain("src/app.txt");
  });
});
```

- [ ] **Step 2: Run the live-Codex file directly and verify it fails because the helper and command do not exist yet**

Run: `RUN_LIVE_CODEX_SMOKE=1 npm --prefix v2 exec vitest run test/live_codex/live_codex_smoke.test.ts`
Expected: FAIL with missing helper/command setup. On machines without live Codex configuration, skip this step and document the local prerequisite in the task notes.

- [ ] **Step 3: Add the fixed rubric and env-gated command wiring**

```md
<!-- v2/test/live_codex/judge_rubric.md -->
# Live Codex Judge Rubric

Return JSON with:
- `verdict`: `"pass"` or `"fail"`
- `reasons`: array of strings grounded in the provided transcript, file list, and git diff

Pass only if all are true:
1. The worker completed a multi-round interaction through the router path.
2. The final files satisfy the requested toy-app behavior.
3. The transcript shows no unrecovered stale-control or restart corruption.
4. Every reason cites a concrete artifact.
```

```json
// v2/package.json
{
  "scripts": {
    "test:live-codex": "vitest run test/live_codex/live_codex_smoke.test.ts"
  }
}
```

- [ ] **Step 4: Implement the minimal live smoke harness and keep it strictly optional**

```ts
// v2/test/live_codex/live_codex_smoke.test.ts
if (!runLiveCodex) {
  // This file remains opt-in to avoid polluting the deterministic required suite.
}
```

The harness should:
- boot the real router
- use mocked Slack transport
- launch one live Codex worker session
- capture transcript, files, and git diff
- launch one live Codex judge against those artifacts
- return both the structured judge verdict and objective checks

- [ ] **Step 5: Update README documentation for deterministic vs live realism paths**

```md
## Test Commands

- `npm --prefix v2 test`
- `npm --prefix v2 run coverage`
- `npm --prefix v2 run test:real-integration`
- `RUN_LIVE_CODEX_SMOKE=1 npm --prefix v2 run test:live-codex`

`test:live-codex` is optional and requires a local Codex runtime configuration.
```

- [ ] **Step 6: Run the deterministic suite plus the live command if configured**

Run: `npm --prefix v2 run test:real-integration`
Expected: PASS

Run: `RUN_LIVE_CODEX_SMOKE=1 npm --prefix v2 run test:live-codex`
Expected: PASS on configured machines, otherwise SKIP by environment gate.

- [ ] **Step 7: Commit the live-Codex slice**

```bash
git add v2/package.json \
  README.md \
  v2/test/live_codex/live_codex_smoke.test.ts \
  v2/test/live_codex/judge_rubric.md
git commit -m "test: add optional live codex smoke path"
```

### Task 6: Run the full confidence pipeline and document any surfaced production bugs

**Files:**
- Modify: `README.md`
- Modify: `docs/agent/plans/2026-03-31-v2-heavy-e2e-test-campaign.md`

- [ ] **Step 1: Run the full deterministic verification pipeline**

Run: `npm --prefix v2 run build`
Expected: PASS

Run: `npm --prefix v2 test`
Expected: PASS

Run: `npm --prefix v2 run coverage`
Expected: PASS

Run: `npm --prefix v2 run test:real-integration`
Expected: PASS

- [ ] **Step 2: Capture any production defects found during execution in the plan itself**

```md
- [x] **Step N: Fix stale merge confirmation replay**
Observed: The new heavy merge scenario showed `confirmMergeToMain()` still accepted a replayed confirmation after the thread had returned to `main`; the fix tightened selection validation before the base-branch guard.
```

- [ ] **Step 3: Update the README with the final test architecture and commands**

```md
The main confidence gate is `test:real-integration`, which exercises real router/runtime/process/git flows. The optional live-Codex path is supplemental and env-gated.
```

- [ ] **Step 4: Commit the verification/docs slice**

```bash
git add README.md docs/agent/plans/2026-03-31-v2-heavy-e2e-test-campaign.md
git commit -m "docs: record heavy e2e verification results"
```
