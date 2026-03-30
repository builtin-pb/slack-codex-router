# Slack Codex Router v2 Stronger Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand `v2` testing in two tracks: fast harness-backed integration tests for stateful Slack/runtime behavior, and a separate `test:real-integration` suite for real git, real child-process transport, and true restart-loop behavior.

**Architecture:** Preserve the existing fast suite as the default developer loop. Add missing state-machine coverage on top of the current runtime harness, then add a dedicated real-integration directory with real temp-repo and real child-process fixtures. Keep the slow suite intentionally small and focused on seams that are risky precisely because mocks can lie.

**Tech Stack:** TypeScript, Node.js, Vitest, SQLite via `better-sqlite3`, git CLI, JSON-line child-process fixtures

---

## File Structure

- Modify: `v2/package.json`
- Modify: `v2/package-lock.json`
- Create: `v2/vitest.fast.config.ts`
- Create: `v2/vitest.real-integration.config.ts`
- Modify: `v2/test/integration_runtime_flow.test.ts`
- Modify: `v2/test/integration_slack_controls.test.ts`
- Create: `v2/test/restart_recovery_matrix.test.ts`
- Create: `v2/test/router_service_stale_rebind_failure.test.ts`
- Create: `v2/test/real_integration/worktree_manager_real_git.test.ts`
- Create: `v2/test/real_integration/router_real_merge_flow.test.ts`
- Create: `v2/test/real_integration/router_real_app_server_flow.test.ts`
- Create: `v2/test/real_integration/router_restart_real_app_server.test.ts`
- Create: `v2/test/real_integration/launcher_restart_loop.test.ts`
- Create: `v2/test/helpers/git_repo_fixture.ts`
- Create: `v2/test/helpers/launcher_fixture.ts`
- Create: `v2/test/helpers/real_app_server_harness.ts`
- Create: `v2/test/fixtures/app_server_stub.mjs`

### Task 1: Add a durable real-integration suite target

**Files:**
- Modify: `v2/package.json`
- Modify: `v2/package-lock.json`
- Create: `v2/vitest.fast.config.ts`
- Create: `v2/vitest.real-integration.config.ts`

- [ ] **Step 1: Verify the dedicated real-integration script does not exist yet**

Run: `npm --prefix v2 run test:real-integration`
Expected: FAIL with “Missing script: test:real-integration”.

- [ ] **Step 2: Add the suite target using a directory pattern, not a fixed file list**

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/bin/router.ts",
    "test": "vitest run --config vitest.fast.config.ts",
    "coverage": "vitest run --config vitest.fast.config.ts --coverage.enabled=true --coverage.provider=v8",
    "test:real-integration": "vitest run --config vitest.real-integration.config.ts"
  }
}
```

```ts
// v2/vitest.fast.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/real_integration/**/*.test.ts"],
  },
});
```

```ts
// v2/vitest.real-integration.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/real_integration/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Refresh the lockfile metadata**

Run: `npm --prefix v2 install`
Expected: PASS

- [ ] **Step 4: Confirm the new script resolves the intended directory**

Run: `npm --prefix v2 run test:real-integration`
Expected: FAIL because `test/real_integration/*.test.ts` does not exist yet, not because the script is missing.

- [ ] **Step 5: Commit**

```bash
git add v2/package.json v2/package-lock.json
git commit -m "test: add real-integration suite target"
```

### Task 2: Expand fast runtime-harness coverage for stateful Slack controls

**Files:**
- Modify: `v2/test/integration_runtime_flow.test.ts`
- Modify: `v2/test/integration_slack_controls.test.ts`

- [ ] **Step 1: Add failing request-user-input round-trip coverage**

```ts
// v2/test/integration_runtime_flow.test.ts
it("turns requestUserInput notifications into a live choice action that resumes the thread", async () => {
  const harness = await createRuntimeHarness();

  try {
    await harness.dispatchTopLevelMessage({
      user: "U123",
      channel: "C08TEMPLATE",
      ts: "1710000000.0001",
      text: "Investigate the repo",
    });

    harness.emitNotification({
      method: "tool/requestUserInput",
      params: {
        threadId: "thread_abc",
        questions: [
          {
            id: "approval",
            header: "Decision",
            question: "Choose one",
            options: [{ label: "Approve" }, { label: "Deny" }],
          },
        ],
      },
    });

    await harness.dispatchAction("codex_choice:approval-1", {
      action: { action_id: "codex_choice:approval-1", value: "Approve" },
      user: { id: "U123" },
      channel: { id: "C08TEMPLATE" },
      message: { thread_ts: "1710000000.0001" },
    });

    expect(harness.store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      state: "running",
      activeTurnId: "turn_abc",
    });
  } finally {
    harness.cleanup();
  }
});
```

- [ ] **Step 2: Add failing action-context and merge-flow coverage**

```ts
// v2/test/integration_slack_controls.test.ts
it("resolves top-level controls via message.ts when thread_ts is absent", async () => {
  const harness = await createRuntimeHarness({ seedThread: true });

  try {
    await harness.dispatchAction("status", {
      user: { id: "U123" },
      channel: { id: "C08TEMPLATE" },
      message: { ts: "1710000000.0001" },
    });

    expect(harness.actionResponses[0]).toMatchObject({
      text: expect.stringContaining("State: idle"),
    });
  } finally {
    harness.cleanup();
  }
});

it("runs merge preview and merge confirm through live Slack actions", async () => {
  const harness = await createRuntimeHarness({ seedThread: true, seedIdleThread: true });

  try {
    await harness.dispatchAction("merge_to_main", {
      user: { id: "U123" },
      channel: { id: "C08TEMPLATE" },
      message: { thread_ts: "1710000000.0001" },
    });

    await harness.dispatchAction("confirm_merge_to_main", {
      action: { action_id: "confirm_merge_to_main", value: "codex/slack/1710000000-0001:main" },
      user: { id: "U123" },
      channel: { id: "C08TEMPLATE" },
      message: { thread_ts: "1710000000.0001" },
    });

    expect(harness.store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      branchName: "main",
      appServerSessionStale: true,
    });
  } finally {
    harness.cleanup();
  }
});
```

- [ ] **Step 3: Run the targeted fast integration tests to verify they fail**

Run: `npm --prefix v2 test -- test/integration_runtime_flow.test.ts test/integration_slack_controls.test.ts`
Expected: FAIL because the current harness and assertions do not yet cover these flows.

- [ ] **Step 4: Extend the harness and fast integration tests**

```ts
// v2/test/helpers/runtime_harness.ts
export async function createRuntimeHarness(options: {
  seedThread?: boolean;
  seedIdleThread?: boolean;
  seedAwaitingUserInputThread?: boolean;
} = {}) {
  // extend the existing harness so seeded thread records can represent:
  // - idle merge-ready threads
  // - awaiting_user_input threads with rendered choice-state metadata
  // - the existing default running-thread seed
}
```

```ts
// v2/test/integration_slack_controls.test.ts
it("rejects stale recovered choice clicks without mutating the record", async () => {
  const harness = await createRuntimeHarness({ seedAwaitingUserInputThread: true });

  try {
    harness.store.upsertThread({
      ...harness.store.getThread("C08TEMPLATE", "1710000000.0001")!,
      appServerSessionStale: true,
      state: "interrupted",
      activeTurnId: null,
    });

    await harness.dispatchAction("codex_choice:approval-1", {
      action: { action_id: "codex_choice:approval-1", value: "Approve" },
      user: { id: "U123" },
      channel: { id: "C08TEMPLATE" },
      message: { thread_ts: "1710000000.0001" },
    });

    expect(harness.actionResponses.at(-1)).toMatchObject({
      text: expect.stringContaining("new message"),
    });
    expect(harness.store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      appServerSessionStale: true,
      state: "interrupted",
    });
  } finally {
    harness.cleanup();
  }
});

it("rejects stale recovered review actions without mutating the record", async () => {
  const harness = await createRuntimeHarness({ seedIdleThread: true });

  try {
    harness.store.upsertThread({
      ...harness.store.getThread("C08TEMPLATE", "1710000000.0001")!,
      appServerSessionStale: true,
      state: "idle",
    });

    await harness.dispatchAction("review", {
      user: { id: "U123" },
      channel: { id: "C08TEMPLATE" },
      message: { thread_ts: "1710000000.0001" },
    });

    expect(harness.actionResponses.at(-1)).toMatchObject({
      text: expect.stringContaining("new message"),
    });
    expect(harness.store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      appServerSessionStale: true,
      state: "idle",
    });
  } finally {
    harness.cleanup();
  }
});

it("rejects a replayed merge confirmation after the thread has already reset to base", async () => {
  const harness = await createRuntimeHarness({ seedThread: true, seedIdleThread: true });

  try {
    await harness.dispatchAction("confirm_merge_to_main", {
      action: { action_id: "confirm_merge_to_main", value: "codex/slack/1710000000-0001:main" },
      user: { id: "U123" },
      channel: { id: "C08TEMPLATE" },
      message: { thread_ts: "1710000000.0001" },
    });

    await harness.dispatchAction("confirm_merge_to_main", {
      action: { action_id: "confirm_merge_to_main", value: "codex/slack/1710000000-0001:main" },
      user: { id: "U123" },
      channel: { id: "C08TEMPLATE" },
      message: { thread_ts: "1710000000.0001" },
    });

    expect(harness.actionResponses.at(-1)).toMatchObject({
      text: expect.stringContaining("stale"),
    });
  } finally {
    harness.cleanup();
  }
});
```

- [ ] **Step 5: Run the targeted fast integration tests to verify they pass**

Run: `npm --prefix v2 test -- test/integration_runtime_flow.test.ts test/integration_slack_controls.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add v2/test/integration_runtime_flow.test.ts v2/test/integration_slack_controls.test.ts v2/test/helpers/runtime_harness.ts
git commit -m "test: cover stateful Slack control flows"
```

### Task 3: Add fast regression coverage for recovery semantics and stale-session rollback

**Files:**
- Create: `v2/test/restart_recovery_matrix.test.ts`
- Create: `v2/test/router_service_stale_rebind_failure.test.ts`

- [ ] **Step 1: Add failing recovery-matrix coverage**

```ts
// v2/test/restart_recovery_matrix.test.ts
import { describe, expect, it } from "vitest";
import { recoverAfterRestart } from "../src/runtime/restart.js";

describe("recoverAfterRestart matrix", () => {
  it("keeps idle threads idle, interrupts active threads, clears turns, and marks recovered rows stale", async () => {
    const result = await recoverAfterRestart({
      pendingRestartIntent: {
        slackChannelId: "C08TEMPLATE",
        slackThreadTs: "1710000000.0009",
        requestedAt: "2026-03-30T00:00:00.000Z",
      },
      recoverableThreads: [
        {
          slackChannelId: "C08TEMPLATE",
          slackThreadTs: "idle-thread",
          appServerThreadId: "thread_idle",
          activeTurnId: null,
          appServerSessionStale: false,
          state: "idle",
          worktreePath: "/repo/worktree-idle",
          branchName: "main",
          baseBranch: "main",
        },
        {
          slackChannelId: "C08TEMPLATE",
          slackThreadTs: "running-thread",
          appServerThreadId: "thread_running",
          activeTurnId: "turn_running",
          appServerSessionStale: false,
          state: "running",
          worktreePath: "/repo/worktree-running",
          branchName: "feature",
          baseBranch: "main",
        },
      ],
    });

    expect(result.recoveredThreads).toEqual([
      expect.objectContaining({
        slackThreadTs: "idle-thread",
        state: "idle",
        activeTurnId: null,
        appServerSessionStale: true,
      }),
      expect.objectContaining({
        slackThreadTs: "running-thread",
        state: "interrupted",
        activeTurnId: null,
        appServerSessionStale: true,
      }),
    ]);
  });
});
```

- [ ] **Step 2: Add failing stale-rebind rollback coverage**

```ts
// v2/test/router_service_stale_rebind_failure.test.ts
import { describe, expect, it, vi } from "vitest";
import { RouterService } from "../src/router/service.js";
import { RouterStore } from "../src/persistence/store.js";
import { createTempProjectFixture } from "./helpers/temp_project.js";

describe("RouterService stale rebind rollback", () => {
  it("restores the original stale record when rebound turnStart fails", async () => {
    const project = createTempProjectFixture();
    const store = new RouterStore(project.routerStateDb);
    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_old",
      activeTurnId: null,
      appServerSessionStale: true,
      state: "interrupted",
      worktreePath: project.projectDir,
      branchName: "codex/slack/1710000000-0001",
      baseBranch: "main",
    });

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: project.projectsFile,
      store,
      threadStart: vi.fn().mockResolvedValue({ threadId: "thread_new" }),
      turnStart: vi.fn().mockRejectedValue(new Error("turn failed")),
    });

    await expect(
      service.handleSlackMessage({
        channelId: "C08TEMPLATE",
        messageTs: "1710000000.0002",
        threadTs: "1710000000.0001",
        text: "continue",
        userId: "U123",
        reply: vi.fn(),
      }),
    ).rejects.toThrow("turn failed");

    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      appServerThreadId: "thread_old",
      appServerSessionStale: true,
      state: "interrupted",
    });

    store.close();
    project.cleanup();
  });
});
```

- [ ] **Step 3: Run the targeted fast regression tests to verify they fail**

Run: `npm --prefix v2 test -- test/restart_recovery_matrix.test.ts test/router_service_stale_rebind_failure.test.ts`
Expected: FAIL because the new files do not exist yet.

- [ ] **Step 4: Implement the regression tests and any tiny fixture support they need**

```ts
// v2/test/restart_recovery_matrix.test.ts
it("pins singleton restart-intent overwrite semantics", async () => {
  const store = createStoreFixture().store;

  store.recordRestartIntent({
    slackChannelId: "C08FIRST",
    slackThreadTs: "1710000000.0001",
    requestedAt: "2026-03-30T00:00:00.000Z",
  });
  store.recordRestartIntent({
    slackChannelId: "C08SECOND",
    slackThreadTs: "1710000000.0002",
    requestedAt: "2026-03-30T00:01:00.000Z",
  });

  expect(store.getPendingRestartIntent()).toEqual({
    slackChannelId: "C08SECOND",
    slackThreadTs: "1710000000.0002",
    requestedAt: "2026-03-30T00:01:00.000Z",
  });
});
```

```ts
// v2/test/router_service_stale_rebind_failure.test.ts
it("does not persist any thread row when worktree allocation fails before threadStart", async () => {
  const project = createTempProjectFixture();
  const store = new RouterStore(project.routerStateDb);
  const threadStart = vi.fn();
  const service = new RouterService({
    allowedUserId: "U123",
    projectsFile: project.projectsFile,
    store,
    ensureThreadWorktree: vi.fn().mockRejectedValue(new Error("git worktree add failed")),
    threadStart,
    turnStart: vi.fn(),
  });

  await expect(
    service.handleSlackMessage({
      channelId: "C08TEMPLATE",
      messageTs: "1710000000.0001",
      threadTs: "1710000000.0001",
      text: "start",
      userId: "U123",
      reply: vi.fn(),
    }),
  ).rejects.toThrow("git worktree add failed");

  expect(threadStart).not.toHaveBeenCalled();
  expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toBeNull();

  store.close();
  project.cleanup();
});
```

- [ ] **Step 5: Run the targeted fast regression tests to verify they pass**

Run: `npm --prefix v2 test -- test/restart_recovery_matrix.test.ts test/router_service_stale_rebind_failure.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add v2/test/restart_recovery_matrix.test.ts v2/test/router_service_stale_rebind_failure.test.ts
git commit -m "test: pin recovery matrix and stale rollback behavior"
```

### Task 4: Build a real git fixture and cover real worktree and merge semantics

**Files:**
- Create: `v2/test/helpers/git_repo_fixture.ts`
- Create: `v2/test/real_integration/worktree_manager_real_git.test.ts`
- Create: `v2/test/real_integration/router_real_merge_flow.test.ts`

- [ ] **Step 1: Add failing real-git tests**

```ts
// v2/test/real_integration/worktree_manager_real_git.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { createGitRepoFixture } from "../helpers/git_repo_fixture.js";

describe("WorktreeManager real git", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("creates a real worktree from the requested base branch tip", async () => {
    const repo = await createGitRepoFixture({ divergedBranch: "release/test-base" });
    cleanups.push(repo.cleanup);

    const manager = repo.createWorktreeManager();
    const result = await manager.ensureThreadWorktree({
      repoPath: repo.repoPath,
      slackThreadTs: "1710000000.0002",
      baseBranch: "release/test-base",
    });

    expect(await repo.currentBranch(result.worktreePath)).toBe("codex/slack/1710000000-0002");
    expect(await repo.revParseHead(result.worktreePath)).toBe(
      await repo.revParse("release/test-base"),
    );
  });

  it("fails when the base branch does not exist", async () => {
    const repo = await createGitRepoFixture();
    cleanups.push(repo.cleanup);

    await expect(
      repo.createWorktreeManager().ensureThreadWorktree({
        repoPath: repo.repoPath,
        slackThreadTs: "1710000000.0003",
        baseBranch: "missing-branch",
      }),
    ).rejects.toThrow();
  });

  it("fails when the worktree path already exists as a non-empty directory", async () => {
    const repo = await createGitRepoFixture();
    cleanups.push(repo.cleanup);

    const worktreePath = repo.buildWorktreePath("1710000000.0004");
    await repo.createNonEmptyDirectory(worktreePath);

    await expect(
      repo.createWorktreeManager().ensureThreadWorktree({
        repoPath: repo.repoPath,
        slackThreadTs: "1710000000.0004",
        baseBranch: repo.defaultBranch,
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the real-git tests to verify they fail**

Run: `npm --prefix v2 run test:real-integration -- test/real_integration/worktree_manager_real_git.test.ts`
Expected: FAIL because the helper and test file do not exist yet.

- [ ] **Step 3: Implement the temp git fixture**

```ts
// v2/test/helpers/git_repo_fixture.ts
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { WorktreeManager, buildWorktreePath } from "../../src/worktree/manager.js";

const execFileAsync = promisify(execFile);

export async function createGitRepoFixture(options: {
  divergedBranch?: string;
} = {}) {
  const repoPath = mkdtempSync(join(tmpdir(), "router-real-git-"));

  await execFileAsync("git", ["init"], { cwd: repoPath });
  await execFileAsync("git", ["config", "user.name", "Router Tests"], { cwd: repoPath });
  await execFileAsync("git", ["config", "user.email", "router-tests@example.com"], { cwd: repoPath });
  await execFileAsync("git", ["checkout", "-b", "main"], { cwd: repoPath });

  writeFileSync(join(repoPath, "README.md"), "# temp repo\n", "utf8");
  writeFileSync(
    join(repoPath, "projects.yaml"),
    [
      "projects:",
      "  - channel_id: C08TEMPLATE",
      "    name: template",
      `    path: ${JSON.stringify(repoPath)}`,
    ].join("\n"),
    "utf8",
  );
  await execFileAsync("git", ["add", "README.md"], { cwd: repoPath });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoPath });

  if (options.divergedBranch) {
    await execFileAsync("git", ["checkout", "-b", options.divergedBranch], { cwd: repoPath });
    writeFileSync(join(repoPath, "branch.txt"), `${options.divergedBranch}\n`, "utf8");
    await execFileAsync("git", ["add", "branch.txt"], { cwd: repoPath });
    await execFileAsync("git", ["commit", "-m", "diverge"], { cwd: repoPath });
    await execFileAsync("git", ["checkout", "main"], { cwd: repoPath });
  }

  return {
    repoPath,
    routerStateDb: join(repoPath, "router.sqlite3"),
    projectsFile: join(repoPath, "projects.yaml"),
    defaultBranch: "main",
    cleanup: () => rmSync(repoPath, { recursive: true, force: true }),
    buildWorktreePath(threadTs: string) {
      return buildWorktreePath(repoPath, threadTs);
    },
    async revParse(ref: string) {
      const result = await execFileAsync("git", ["rev-parse", ref], { cwd: repoPath });
      return result.stdout.trim();
    },
    async revParseHead(cwd: string) {
      const result = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
      return result.stdout.trim();
    },
    async currentBranch(cwd: string) {
      const result = await execFileAsync("git", ["branch", "--show-current"], { cwd });
      return result.stdout.trim();
    },
    async createNonEmptyDirectory(path: string) {
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, "placeholder.txt"), "occupied\n", "utf8");
    },
    removePath(path: string) {
      rmSync(path, { recursive: true, force: true });
    },
    async statusPorcelain(cwd: string) {
      const result = await execFileAsync("git", ["status", "--porcelain"], { cwd });
      return result.stdout;
    },
    async commitFile(cwd: string, relativePath: string, contents: string, message: string) {
      writeFileSync(join(cwd, relativePath), contents, "utf8");
      await execFileAsync("git", ["add", relativePath], { cwd });
      await execFileAsync("git", ["commit", "-m", message], { cwd });
    },
    async mergeFromRoot(input: { sourceBranch: string; targetBranch: string }) {
      await execFileAsync("git", ["checkout", input.targetBranch], { cwd: repoPath });
      await execFileAsync("git", ["merge", "--ff", input.sourceBranch], { cwd: repoPath });
    },
    async fileContents(cwd: string, relativePath: string) {
      return readFileSync(join(cwd, relativePath), "utf8");
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

- [ ] **Step 4: Add the remaining negative and operational assertions**

```ts
// v2/test/real_integration/worktree_manager_real_git.test.ts
it("fails when the old worktree path is gone but the branch still exists", async () => {
  const repo = await createGitRepoFixture();
  const manager = repo.createWorktreeManager();
  const first = await manager.ensureThreadWorktree({
    repoPath: repo.repoPath,
    slackThreadTs: "1710000000.0005",
    baseBranch: repo.defaultBranch,
  });

  repo.removePath(first.worktreePath);

  await expect(
    manager.ensureThreadWorktree({
      repoPath: repo.repoPath,
      slackThreadTs: "1710000000.0005",
      baseBranch: repo.defaultBranch,
    }),
  ).rejects.toThrow();
});

it("proves whether .codex-worktrees dirties the root checkout", async () => {
  const repo = await createGitRepoFixture();
  await repo.createWorktreeManager().ensureThreadWorktree({
    repoPath: repo.repoPath,
    slackThreadTs: "1710000000.0006",
    baseBranch: repo.defaultBranch,
  });

  expect(await repo.statusPorcelain(repo.repoPath)).toContain(".codex-worktrees/");
});
```

```ts
// v2/test/real_integration/router_real_merge_flow.test.ts
import { describe, expect, it } from "vitest";
import { RouterStore } from "../../src/persistence/store.js";
import { RouterService } from "../../src/router/service.js";
import { createGitRepoFixture } from "../helpers/git_repo_fixture.js";

describe("real merge flow", () => {
  it("merges from repo root while the source branch is checked out in a linked worktree", async () => {
    const repo = await createGitRepoFixture({ divergedBranch: "feature/merge-test" });
    const worktree = await repo.createWorktreeManager().ensureThreadWorktree({
      repoPath: repo.repoPath,
      slackThreadTs: "1710000000.0010",
      baseBranch: "feature/merge-test",
    });

    await repo.commitFile(worktree.worktreePath, "feature.txt", "merged\n", "feature commit");
    await repo.mergeFromRoot({
      sourceBranch: worktree.branchName,
      targetBranch: "main",
    });

    expect(await repo.fileContents(repo.repoPath, "feature.txt")).toBe("merged\n");
  });

  it("leaves persisted thread metadata unchanged when merge fails", async () => {
    const repo = await createGitRepoFixture({ divergedBranch: "feature/conflict-test" });
    const store = new RouterStore(repo.routerStateDb);
    const initialRecord = {
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0011",
      appServerThreadId: "thread_merge",
      activeTurnId: null,
      appServerSessionStale: false,
      state: "idle" as const,
      worktreePath: `${repo.repoPath}/.codex-worktrees/1710000000-0011`,
      branchName: "codex/slack/1710000000-0011",
      baseBranch: "main",
    };
    store.upsertThread(initialRecord);

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: repo.projectsFile,
      store,
      threadStart: async () => ({ threadId: "thread_merge" }),
      turnStart: async () => ({ turnId: "turn_merge" }),
      executeMergeToMain: async ({ sourceBranch, targetBranch }) => {
        await repo.mergeFromRoot({ sourceBranch, targetBranch });
        return { text: "merged" };
      },
    });

    await expect(
      service.confirmMergeToMain(
        "U123",
        "C08TEMPLATE",
        "1710000000.0011",
        { sourceBranch: "missing-source-branch", targetBranch: "main" },
      ),
    ).rejects.toThrow();

    expect(store.getThread("C08TEMPLATE", "1710000000.0011")).toEqual(initialRecord);
    store.close();
  });
});
```

- [ ] **Step 5: Run the real-git tests to verify they pass**

Run: `npm --prefix v2 run test:real-integration -- test/real_integration/worktree_manager_real_git.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add v2/test/helpers/git_repo_fixture.ts v2/test/real_integration/worktree_manager_real_git.test.ts v2/test/real_integration/router_real_merge_flow.test.ts
git commit -m "test: cover real git worktree and merge behavior"
```

### Task 5: Build a real App Server child harness and transport-flow tests

**Files:**
- Create: `v2/test/helpers/real_app_server_harness.ts`
- Create: `v2/test/fixtures/app_server_stub.mjs`
- Create: `v2/test/real_integration/router_real_app_server_flow.test.ts`

- [ ] **Step 1: Add failing real-transport tests**

```ts
// v2/test/real_integration/router_real_app_server_flow.test.ts
import { describe, expect, it } from "vitest";
import { createRealAppServerHarness } from "../helpers/real_app_server_harness.js";

describe("router runtime with a real app-server child", () => {
  it("sends initialize/thread-start/turn-start over the real transport and receives stdout-driven notifications", async () => {
    const harness = await createRealAppServerHarness({ scenario: "happy-path" });

    try {
      await harness.dispatchTopLevelMessage({
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0001",
        text: "Investigate the repo",
      });

      await harness.waitForRequest("initialize");
      await harness.waitForRequest("thread/start");
      const turnStartRequest = await harness.waitForRequest("turn/start");

      expect(turnStartRequest.params).toMatchObject({
        cwd: expect.stringContaining(".codex-worktrees/"),
      });
      expect(turnStartRequest.params).toMatchObject({
        threadId: "thread_abc",
        input: [{ type: "text", text: "Investigate the repo" }],
      });
      expect(harness.store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
        state: "running",
        activeTurnId: "turn_abc",
      });
      expect(harness.slack.postedMessages.at(-1)).toMatchObject({
        thread_ts: "1710000000.0001",
        text: "Working on it.",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("survives fragmented and coalesced stdout framing", async () => {
    const fragmented = await createRealAppServerHarness({ scenario: "fragmented-output" });
    const coalesced = await createRealAppServerHarness({ scenario: "coalesced-output" });

    try {
      await fragmented.dispatchTopLevelMessage({
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0002",
        text: "Investigate the repo",
      });
      await coalesced.dispatchTopLevelMessage({
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0003",
        text: "Investigate the repo",
      });

      expect((await fragmented.waitForRequest("turn/start")).params).toMatchObject({
        threadId: "thread_abc",
      });
      expect(coalesced.store.getThread("C08TEMPLATE", "1710000000.0003")).toMatchObject({
        activeTurnId: "turn_abc",
      });
    } finally {
      await fragmented.cleanup();
      await coalesced.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run the real-process tests to verify they fail**

Run: `npm --prefix v2 run test:real-integration -- test/real_integration/router_real_app_server_flow.test.ts`
Expected: FAIL because the helper and stub fixture do not exist yet.

- [ ] **Step 3: Implement the child-process stub**

```js
// v2/test/fixtures/app_server_stub.mjs
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const scenario = process.env.APP_SERVER_STUB_SCENARIO ?? "happy-path";
const requestLogPath = process.env.APP_SERVER_STUB_REQUEST_LOG;
const threadId = process.env.APP_SERVER_STUB_THREAD_ID ?? "thread_abc";

function writeRaw(text) {
  process.stdout.write(text);
}

function writeJson(message) {
  writeRaw(`${JSON.stringify(message)}\n`);
}

function logRequest(request) {
  if (requestLogPath) {
    appendFileSync(requestLogPath, `${JSON.stringify(request)}\n`, "utf8");
  }
}

function emitHappyPathNotifications() {
  writeJson({ method: "thread/status/changed", params: { threadId, state: "running" } });
  writeJson({
    method: "item/completed",
    params: { threadId, item: { type: "message", role: "assistant", text: "Working on it." } },
  });
}

rl.on("line", (line) => {
  const request = JSON.parse(line);
  logRequest(request);

  if (request.method === "initialize") {
    writeJson({ id: request.id, result: { ok: true } });
    return;
  }

  if (request.method === "thread/start") {
    writeJson({ id: request.id, result: { thread: { id: threadId } } });
    return;
  }

  if (request.method === "turn/start") {
    if (scenario === "exit-during-turn-start") {
      process.exit(23);
    }

    if (scenario === "fragmented-output") {
      writeRaw(JSON.stringify({ id: request.id, result: { turn: { id: "turn_abc" } } }).slice(0, 20));
      writeRaw(`${JSON.stringify({ id: request.id, result: { turn: { id: "turn_abc" } } }).slice(20)}\n`);
      writeRaw(
        `${JSON.stringify({ method: "thread/status/changed", params: { threadId, state: "running" } })}\n` +
          `${JSON.stringify({ method: "item/completed", params: { threadId, item: { type: "message", role: "assistant", text: "Working on it." } } })}\n`,
      );
      return;
    }

    if (scenario === "coalesced-output") {
      writeRaw(
        `${JSON.stringify({ id: request.id, result: { turn: { id: "turn_abc" } } })}\n` +
          `${JSON.stringify({ method: "thread/status/changed", params: { threadId, state: "running" } })}\n` +
          `${JSON.stringify({ method: "item/completed", params: { threadId, item: { type: "message", role: "assistant", text: "Working on it." } } })}\n`,
      );
      return;
    }

    writeJson({ id: request.id, result: { turn: { id: "turn_abc" } } });
    emitHappyPathNotifications();
    return;
  }
});
```

- [ ] **Step 4: Implement the real App Server harness**

```ts
// v2/test/helpers/real_app_server_harness.ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppServerClient } from "../../src/app_server/client.js";
import { spawnAppServerProcess } from "../../src/app_server/process.js";
import { mkdirSync } from "node:fs";
import { RouterStore } from "../../src/persistence/store.js";
import { startRouterRuntime } from "../../src/router/runtime.js";
import { RouterService } from "../../src/router/service.js";
import { registerSlackMessageHandler } from "../../src/slack/app.js";
import { buildBranchName, buildWorktreePath } from "../../src/worktree/manager.js";
import { createFakeSlackApp } from "./fake_slack_app.js";
import { createTempProjectFixture } from "./temp_project.js";

export async function createRealAppServerHarness(options: {
  scenario: "happy-path" | "fragmented-output" | "coalesced-output" | "exit-during-turn-start";
}): Promise<{
  slack: ReturnType<typeof createFakeSlackApp>;
  store: RouterStore;
  processExitCodes: number[];
  waitForRequest(method: string, options?: { occurrence?: number }): Promise<Record<string, unknown>>;
  dispatchTopLevelMessage(input: { user: string; channel: string; ts: string; text: string }): Promise<void>;
  dispatchAction(actionId: string, body: Record<string, unknown>): Promise<void>;
  cleanup(): Promise<void>;
}> {
  const project = createTempProjectFixture();
  const repoRootPath = fileURLToPath(new URL("../../..", import.meta.url));
  const slack = createFakeSlackApp();
  const store = new RouterStore(project.routerStateDb);
  const requestLogDir = mkdtempSync(join(tmpdir(), "router-real-app-server-"));
  const requestLogPath = join(requestLogDir, "requests.ndjson");
  const scriptPath = resolve(repoRootPath, "v2/test/fixtures/app_server_stub.mjs");
  const appServerProcess = spawnAppServerProcess([globalThis.process.execPath, scriptPath], {
    cwd: repoRootPath,
    env: {
      ...globalThis.process.env,
      APP_SERVER_STUB_SCENARIO: options.scenario,
      APP_SERVER_STUB_REQUEST_LOG: requestLogPath,
      APP_SERVER_STUB_THREAD_ID: "thread_abc",
    },
  });
  const client = new AppServerClient({
    writeLine: (line) => appServerProcess.writeLine(line),
  });
  const router = new RouterService({
    allowedUserId: project.config.allowedUserId,
    projectsFile: project.config.projectsFile,
    store,
    ensureThreadWorktree: async ({ repoPath, slackThreadTs }) => {
      const worktreePath = buildWorktreePath(repoPath, slackThreadTs);
      mkdirSync(worktreePath, { recursive: true });
      return { worktreePath, branchName: buildBranchName(slackThreadTs) };
    },
    threadStart: async (input) => client.threadStart(input) as Promise<{ threadId: string }>,
    turnStart: async (input) => client.turnStart(input),
  });

  const processExitCodes: number[] = [];
  appServerProcess.waitForExit().then((code) => {
    if (typeof code === "number") {
      processExitCodes.push(code);
    }
  });

  await startRouterRuntime({
    config: project.config,
    store,
    appServerProcess,
    appServerClient: client,
    slackApp: slack.app,
    routerService: router,
    registerSlackMessageHandler: (app, routerService) => {
      registerSlackMessageHandler(app as never, routerService as never);
    },
  });

  return {
    slack,
    store,
    processExitCodes,
    async waitForRequest(method, waitOptions = {}) {
      const occurrence = waitOptions.occurrence ?? 1;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (existsSync(requestLogPath)) {
          const lines = readFileSync(requestLogPath, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line));
          const match = lines.filter((line) => line.method === method)[occurrence - 1];
          if (match) {
            return match;
          }
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
      }
      throw new Error(`Timed out waiting for request ${method}`);
    },
    async dispatchTopLevelMessage(input) {
      await slack.dispatchMessage(input);
    },
    async dispatchAction(actionId, body) {
      await slack.dispatchAction(actionId, body);
    },
    async cleanup() {
      appServerProcess.child.kill();
      store.close();
      project.cleanup();
      rmSync(requestLogDir, { recursive: true, force: true });
    },
  };
}
```

- [ ] **Step 5: Run the real-process tests to verify they pass**

Run: `npm --prefix v2 run test:real-integration -- test/real_integration/router_real_app_server_flow.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add v2/test/helpers/real_app_server_harness.ts v2/test/fixtures/app_server_stub.mjs v2/test/real_integration/router_real_app_server_flow.test.ts
git commit -m "test: cover real app-server transport flow"
```

### Task 6: Add true cross-boot restart-loop coverage

**Files:**
- Create: `v2/test/real_integration/router_restart_real_app_server.test.ts`
- Create: `v2/test/real_integration/launcher_restart_loop.test.ts`
- Create: `v2/test/helpers/launcher_fixture.ts`
- Modify: `v2/test/helpers/real_app_server_harness.ts`

- [ ] **Step 1: Add failing restart-loop tests**

```ts
// v2/test/real_integration/router_restart_real_app_server.test.ts
import { describe, expect, it } from "vitest";
import { RESTART_EXIT_CODE } from "../../src/runtime/restart.js";
import { createRealAppServerHarness } from "../helpers/real_app_server_harness.js";

describe("real restart recovery", () => {
  it("creates a thread on boot 1, requests restart, reboots against the same db, and rebinds the first post-restart reply", async () => {
    const harness = await createRealAppServerHarness({ scenario: "happy-path", persistentStore: true });

    try {
      await harness.dispatchTopLevelMessage({
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0001",
        text: "Investigate the repo",
      });

      await harness.dispatchAction("restart_router", {
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
      });

      const beforeRestart = harness.store.getThread("C08TEMPLATE", "1710000000.0001")!;
      expect(harness.processExitCodes).toContain(RESTART_EXIT_CODE);

      await harness.bootNextGeneration();

      expect(harness.slack.postedMessages.at(-1)).toMatchObject({
        thread_ts: "1710000000.0001",
        text: expect.stringContaining("Router restarted."),
      });

      await harness.dispatchThreadReply({
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0002",
        thread_ts: "1710000000.0001",
        text: "continue",
      });

      const reboundThreadStart = await harness.waitForRequest("thread/start", { occurrence: 2 });
      const reboundTurnStart = await harness.waitForRequest("turn/start", { occurrence: 2 });
      const afterRestart = harness.store.getThread("C08TEMPLATE", "1710000000.0001")!;

      expect(reboundThreadStart).toBeTruthy();
      expect(reboundTurnStart.params).toMatchObject({
        threadId: afterRestart.appServerThreadId,
      });
      expect(afterRestart.appServerThreadId).not.toBe(beforeRestart.appServerThreadId);
      expect(afterRestart).toMatchObject({
        appServerSessionStale: false,
        state: "running",
      });
    } finally {
      await harness.cleanup();
    }
  });
});
```

```ts
// v2/test/real_integration/launcher_restart_loop.test.ts
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createLauncherFixture } from "../helpers/launcher_fixture.js";

describe("launcher-mediated restart loop", () => {
  it("restarts a worker after exit code 75 and runs a second generation", async () => {
    const fixture = await createLauncherFixture();

    try {
      const child = spawn(process.execPath, [fixture.wrapperEntry], {
        cwd: fixture.repoRootPath,
        env: fixture.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      await fixture.waitForWorkerGeneration(1);
      await fixture.waitForWorkerGeneration(2);
      expect(await fixture.observedExitCodes()).toContain(75);

      child.kill("SIGTERM");
      await once(child, "exit");
    } finally {
      await fixture.cleanup();
    }
  });
});
```

```ts
// v2/test/helpers/launcher_fixture.ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function createLauncherFixture() {
  const tempDir = mkdtempSync(join(tmpdir(), "router-launcher-fixture-"));
  const repoRootPath = fileURLToPath(new URL("../../..", import.meta.url));
  const logFile = join(tempDir, "launcher.log");
  const workerScript = join(tempDir, "worker.mjs");
  const wrapperEntry = join(tempDir, "launcher-wrapper.mjs");

  writeFileSync(
    workerScript,
    [
      'import { appendFileSync } from "node:fs";',
      'appendFileSync(process.env.LAUNCHER_TEST_LOG, `worker:${process.env.LAUNCHER_TEST_GENERATION}\\n`, "utf8");',
      'process.exit(process.env.LAUNCHER_TEST_GENERATION === "1" ? 75 : 0);',
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    wrapperEntry,
    [
      'import { spawn } from "node:child_process";',
      'const { buildLauncher } = await import(process.env.LAUNCHER_RUNTIME_MODULE);',
      'let generation = 0;',
      'const launcher = buildLauncher({',
      '  async spawnWorker() {',
      '    generation += 1;',
      '    const child = spawn(process.execPath, [process.env.LAUNCHER_TEST_WORKER], {',
      '      env: { ...process.env, LAUNCHER_TEST_GENERATION: String(generation) },',
      '      stdio: "inherit",',
      '    });',
      '    return { wait: () => new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 0))) };',
      '  },',
      '});',
      'const exitCode = await launcher.runOnce();',
      'process.exit(exitCode);',
    ].join("\n"),
    "utf8",
  );

  return {
    wrapperEntry,
    repoRootPath,
    env: {
      ...process.env,
      LAUNCHER_TEST_LOG: logFile,
      LAUNCHER_TEST_WORKER: workerScript,
      LAUNCHER_RUNTIME_MODULE: `${repoRootPath}/v2/src/runtime/launcher.js`,
    },
    async waitForWorkerGeneration(n: number) {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const count = readFileSync(logFile, "utf8")
          .split("\n")
          .filter((line) => line.startsWith("worker:")).length;
        if (count >= n) {
          return;
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
      }
      throw new Error(`Timed out waiting for worker generation ${n}`);
    },
    async observedExitCodes() {
      return readFileSync(logFile, "utf8")
        .split("\n")
        .filter((line) => line.startsWith("worker:"))
        .map((line) => (line.endsWith("1") ? 75 : 0));
    },
    async cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}
```

- [ ] **Step 2: Run the restart-loop tests to verify they fail**

Run: `npm --prefix v2 run test:real-integration -- test/real_integration/router_restart_real_app_server.test.ts test/real_integration/launcher_restart_loop.test.ts`
Expected: FAIL because cross-boot helpers do not exist yet.

- [ ] **Step 3: Extend the real App Server harness for multiple generations**

```ts
// v2/test/helpers/real_app_server_harness.ts
export async function createRealAppServerHarness(options: {
  scenario: "happy-path" | "fragmented-output" | "coalesced-output" | "exit-during-turn-start";
  persistentStore?: boolean;
}) {
  const processExitCodes: number[] = [];
  let generation = 0;
  let runtime = await boot();

  async function boot() {
    generation += 1;
    const appServerProcess = spawnAppServerProcess([globalThis.process.execPath, scriptPath], {
      cwd: repoRootPath,
      env: {
        ...globalThis.process.env,
        APP_SERVER_STUB_SCENARIO: options.scenario,
        APP_SERVER_STUB_REQUEST_LOG: requestLogPath,
        APP_SERVER_STUB_THREAD_ID: `thread_gen_${generation}`,
      },
    });
    appServerProcess.waitForExit().then((code) => {
      if (typeof code === "number") {
        processExitCodes.push(code);
      }
    });

    const client = new AppServerClient({
      writeLine: (line) => appServerProcess.writeLine(line),
    });

    await startRouterRuntime({
      config: project.config,
      store,
      appServerProcess,
      appServerClient: client,
      slackApp: slack.app,
      routerService,
      registerSlackMessageHandler: (app, routerService) => {
        registerSlackMessageHandler(app as never, routerService as never, {
          requestProcessExit(exitCode) {
            processExitCodes.push(exitCode);
            appServerProcess.child.kill();
          },
        });
      },
    });

    return appServerProcess;
  }

  return {
    processExitCodes,
    async bootNextGeneration() {
      runtime = await boot();
    },
    async dispatchThreadReply(input: {
      user: string;
      channel: string;
      ts: string;
      thread_ts: string;
      text: string;
    }) {
      await slack.dispatchMessage(input);
    },
  };
}
```

- [ ] **Step 4: Add the real-process failure case**

```ts
// v2/test/real_integration/router_restart_real_app_server.test.ts
it("rolls back thread state when the child exits during turn/start", async () => {
  const harness = await createRealAppServerHarness({ scenario: "exit-during-turn-start" });

  try {
    await expect(
      harness.dispatchTopLevelMessage({
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0009",
        text: "Investigate the repo",
      }),
    ).rejects.toThrow();

    expect(harness.store.getThread("C08TEMPLATE", "1710000000.0009")).toMatchObject({
      state: "failed_setup",
    });
  } finally {
    await harness.cleanup();
  }
});
```

- [ ] **Step 5: Run the full real-integration suite**

Run: `npm --prefix v2 run test:real-integration`
Expected: PASS

- [ ] **Step 6: Run the full repo verification**

Run: `npm --prefix v2 test`
Expected: PASS

Run: `npm --prefix v2 run build`
Expected: PASS

Run: `npm --prefix v2 run coverage`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add v2/test/helpers/real_app_server_harness.ts v2/test/real_integration/router_restart_real_app_server.test.ts v2/test/real_integration/launcher_restart_loop.test.ts
git commit -m "test: cover real restart loop and child failure rollback"
```

## Notes For Execution

- Keep all new slow tests under `v2/test/real_integration/`.
- Do not move any real git or child-process tests into the default `test` script.
- Prefer strong end-state assertions over brittle timing assertions.
- For non-default base-branch coverage, compare `HEAD` directly to the requested branch tip.
- For restart coverage, do not stop at “recovery message posted”; prove first post-restart stale-session rebound.
