import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterStore } from "../src/persistence/store.js";
import { RouterService } from "../src/router/service.js";

function createRegistryFixture(pathEntry: string): {
  cleanup(): void;
  projectDir: string;
  projectsFile: string;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "router-service-regressions-"));
  const projectDir = join(tempDir, "project");
  const projectsFile = join(tempDir, "projects.yaml");

  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    projectsFile,
    `projects:\n  - channel_id: C08TEMPLATE\n    name: template\n    path: ${JSON.stringify(pathEntry)}\n`,
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

describe("RouterService regressions", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("resolves project paths relative to the registry file", async () => {
    const fixture = createRegistryFixture("project");
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

    expect(threadStart).toHaveBeenCalledWith({
      cwd: fixture.projectDir,
    });
    expect(turnStart).toHaveBeenCalledWith({
      cwd: fixture.projectDir,
      prompt: "Investigate the failing tests",
      threadId: "thread_abc",
    });
    expect(replies).toEqual(["Started Codex task for project `template`."]);
  });

  it("rejects replies that do not have a stored session yet", async () => {
    const fixture = createRegistryFixture("project");
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
      messageTs: "1710000000.0002",
      threadTs: "1710000000.0001",
      text: "Use the narrower repro",
      userId: "U123",
      reply: (message) => {
        replies.push(message);
      },
    });

    expect(threadStart).not.toHaveBeenCalled();
    expect(turnStart).not.toHaveBeenCalled();
    expect(replies).toEqual(["This thread has no stored Codex session yet."]);
  });
});
