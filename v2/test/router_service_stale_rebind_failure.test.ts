import { describe, expect, it, vi } from "vitest";
import { RouterStore } from "../src/persistence/store.js";
import { RouterService } from "../src/router/service.js";
import { createTempProjectFixture } from "./helpers/temp_project.js";

describe("RouterService stale rebind rollback", () => {
  it("restores the original stale record when rebound turnStart fails", async () => {
    const fixture = createTempProjectFixture();
    const store = new RouterStore(fixture.routerStateDb);
    const threadStart = vi.fn().mockResolvedValue({ threadId: "thread_new" });
    const turnStart = vi.fn().mockRejectedValue(new Error("turn failed"));

    try {
      store.upsertThread({
        slackChannelId: "C08TEMPLATE",
        slackThreadTs: "1710000000.0001",
        appServerThreadId: "thread_old",
        activeTurnId: null,
        appServerSessionStale: true,
        state: "interrupted",
        worktreePath: fixture.projectDir,
        branchName: "codex/slack/1710000000-0001",
        baseBranch: "main",
      });

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
          messageTs: "1710000000.0002",
          threadTs: "1710000000.0001",
          text: "continue",
          userId: "U123",
          reply: vi.fn(),
        }),
      ).rejects.toThrow("turn failed");

      expect(threadStart).toHaveBeenCalledTimes(1);
      expect(turnStart).toHaveBeenCalledTimes(1);
      expect(store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
        appServerThreadId: "thread_old",
        activeTurnId: null,
        appServerSessionStale: true,
        state: "interrupted",
        worktreePath: fixture.projectDir,
        branchName: "codex/slack/1710000000-0001",
        baseBranch: "main",
      });
    } finally {
      store.close();
      fixture.cleanup();
    }
  });
});
