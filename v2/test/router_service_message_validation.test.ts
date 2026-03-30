import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterStore } from "../src/persistence/store.js";
import { RouterService } from "../src/router/service.js";

function createRegistryFixture(): {
  cleanup(): void;
  projectsFile: string;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "router-service-message-validation-"));
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
    projectsFile,
  };
}

describe("RouterService message validation", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("rejects empty Slack messages before starting or resuming a task", async () => {
    const fixture = createRegistryFixture();
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
      text: "   ",
      userId: "U123",
      reply: (message) => {
        replies.push(message);
      },
    });

    expect(threadStart).not.toHaveBeenCalled();
    expect(turnStart).not.toHaveBeenCalled();
    expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toBeNull();
    expect(replies).toEqual(["Send a non-empty message to start or continue a task."]);
  });

  it("rejects messages from unregistered channels before touching the App Server", async () => {
    const fixture = createRegistryFixture();
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
      channelId: "C08UNKNOWN",
      messageTs: "1710000000.0001",
      threadTs: "1710000000.0001",
      text: "Investigate the failing tests",
      userId: "U123",
      reply: (message) => {
        replies.push(message);
      },
    });

    expect(threadStart).not.toHaveBeenCalled();
    expect(turnStart).not.toHaveBeenCalled();
    expect(store.getThread("C08UNKNOWN", "1710000000.0001")).toBeNull();
    expect(replies).toEqual(["This channel is not registered to a project."]);
  });
});
