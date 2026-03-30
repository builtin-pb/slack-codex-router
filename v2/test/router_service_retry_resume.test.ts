import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterStore } from "../src/persistence/store.js";
import { RouterService } from "../src/router/service.js";

function createProjectRegistryFixture(): {
  cleanup(): void;
  projectDir: string;
  projectsFile: string;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "router-service-retry-resume-"));
  const projectDir = join(tempDir, "project");
  const projectsFile = join(tempDir, "projects.yaml");

  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    projectsFile,
    `projects:\n  - channel_id: C08TEMPLATE\n    name: template\n    path: ${JSON.stringify(projectDir)}\n`,
    "utf8",
  );

  return {
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
    projectDir,
    projectsFile,
  };
}

describe("RouterService retry resume", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("reuses the stored App Server thread on a later retry after the first turn fails", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const threadStart = vi.fn().mockResolvedValue({ threadId: "thread_abc" });
    const turnStart = vi
      .fn()
      .mockRejectedValueOnce(new Error("turn failed"))
      .mockResolvedValueOnce({ turnId: "turn_retry" });
    const replies: string[] = [];

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart,
      turnStart,
    });

    await expect(
      service.handleSlackMessage({
        channelId: "C08TEMPLATE",
        messageTs: "1710000000.0001",
        threadTs: "1710000000.0001",
        text: "Investigate the failing tests",
        userId: "U123",
        reply: (message) => {
          replies.push(message);
        },
      }),
    ).rejects.toThrow("turn failed");

    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      appServerThreadId: "thread_abc",
      activeTurnId: null,
      state: "failed_setup",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    await service.handleSlackMessage({
      channelId: "C08TEMPLATE",
      messageTs: "1710000000.0002",
      threadTs: "1710000000.0001",
      text: "Continue from the failed attempt",
      userId: "U123",
      reply: (message) => {
        replies.push(message);
      },
    });

    expect(threadStart).toHaveBeenCalledTimes(1);
    expect(turnStart).toHaveBeenCalledTimes(2);
    expect(turnStart).toHaveBeenNthCalledWith(1, {
      cwd: fixture.projectDir,
      prompt: "Investigate the failing tests",
      threadId: "thread_abc",
    });
    expect(turnStart).toHaveBeenNthCalledWith(2, {
      cwd: fixture.projectDir,
      prompt: "Continue from the failed attempt",
      threadId: "thread_abc",
    });
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      appServerThreadId: "thread_abc",
      activeTurnId: "turn_retry",
      state: "running",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });
    expect(replies).toEqual([
      "Continuing Codex task for project `template`.",
    ]);
  });
});
