import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterStore } from "../src/persistence/store.js";
import { RouterService } from "../src/router/service.js";

function createProjectRegistryFixture(): { cleanup(): void; projectDir: string; projectsFile: string } {
  const tempDir = mkdtempSync(join(tmpdir(), "router-service-"));
  const projectDir = join(tempDir, "project");
  const projectsFile = join(tempDir, "projects.yaml");

  mkdirSync(projectDir, { recursive: true });
  writeFileSync(projectsFile, `projects:\n  - channel_id: C08TEMPLATE\n    name: template\n    path: ${JSON.stringify(projectDir)}\n`, "utf8");

  return {
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
    projectDir,
    projectsFile,
  };
}

describe("RouterService", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("starts a new App Server thread for a top-level Slack message and persists the mapping", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const threadStart = vi.fn().mockResolvedValue({ threadId: "thread_abc" });
    const turnStart = vi.fn().mockResolvedValue({ turnId: "turn_abc" });
    const replies: string[] = [];

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart,
      turnStart,
    });

    await service.handleSlackMessage({
      channelId: "C08TEMPLATE",
      messageTs: "1710000000.0001",
      threadTs: "1710000000.0001",
      text: "Investigate the failing tests",
      userId: "U123",
      reply: (message) => {
        replies.push(message);
      },
    });

    expect(threadStart).toHaveBeenCalledTimes(1);
    expect(threadStart).toHaveBeenCalledWith({
      cwd: fixture.projectDir,
    });
    expect(turnStart).toHaveBeenCalledTimes(1);
    expect(turnStart).toHaveBeenCalledWith({
      cwd: fixture.projectDir,
      prompt: "Investigate the failing tests",
      threadId: "thread_abc",
    });
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
      appServerThreadId: "thread_abc",
      state: "running",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });
    expect(replies).toEqual(["Started Codex task for project `template`."]);
  });

  it("resumes a stored App Server thread for Slack replies in an existing thread", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const threadStart = vi.fn();
    const turnStart = vi.fn().mockResolvedValue({ turnId: "turn_resume" });
    const replies: string[] = [];

    store.upsertThread({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
      appServerThreadId: "thread_existing",
      state: "idle",
      worktreePath: fixture.projectDir,
      branchName: "main",
      baseBranch: "main",
    });

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart,
      turnStart,
    });

    await service.handleSlackMessage({
      channelId: "C08TEMPLATE",
      messageTs: "1710000000.0002",
      threadTs: "1710000000.0001",
      text: "Use the narrower repro",
      userId: "U123",
      reply: (message) => {
        replies.push(message);
      },
    });

    expect(threadStart).not.toHaveBeenCalled();
    expect(turnStart).toHaveBeenCalledWith({
      cwd: fixture.projectDir,
      prompt: "Use the narrower repro",
      threadId: "thread_existing",
    });
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")?.state).toBe("running");
    expect(replies).toEqual(["Continuing Codex task for project `template`."]);
  });

  it("rejects unauthorized users before touching the project registry or App Server", async () => {
    const fixture = createProjectRegistryFixture();
    cleanups.push(fixture.cleanup);
    const store = new RouterStore(":memory:");
    cleanups.push(() => store.close());
    const threadStart = vi.fn();
    const turnStart = vi.fn();
    const replies: string[] = [];

    const service = new RouterService({
      allowedUserId: "U123",
      projectsFile: fixture.projectsFile,
      store,
      threadStart,
      turnStart,
    });

    await service.handleSlackMessage({
      channelId: "C08TEMPLATE",
      messageTs: "1710000000.0001",
      threadTs: "1710000000.0001",
      text: "Investigate the failing tests",
      userId: "U999",
      reply: (message) => {
        replies.push(message);
      },
    });

    expect(threadStart).not.toHaveBeenCalled();
    expect(turnStart).not.toHaveBeenCalled();
    expect(replies).toEqual(["User is not allowed to control this router."]);
  });
});
