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
  const tempDir = mkdtempSync(join(tmpdir(), "router-service-retry-"));
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

describe("RouterService retry persistence", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("keeps the App Server thread mapping if the first turn fails", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const threadStart = vi.fn().mockResolvedValue({ threadId: "thread_abc" });
    const turnStart = vi.fn().mockRejectedValue(new Error("turn failed"));
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

    expect(threadStart).toHaveBeenCalledTimes(1);
    expect(turnStart).toHaveBeenCalledTimes(1);
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      appServerThreadId: "thread_abc",
      state: "running",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });
    expect(replies).toEqual([]);
  });
});
