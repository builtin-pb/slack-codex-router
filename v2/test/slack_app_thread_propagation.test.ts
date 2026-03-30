import { describe, expect, it, vi } from "vitest";
import type { RouterService } from "../src/router/service.js";
import { registerSlackMessageHandler } from "../src/slack/app.js";

describe("registerSlackMessageHandler thread propagation", () => {
  it("preserves an existing thread_ts for normal message events", async () => {
    const router = {
      handleSlackMessage: vi.fn().mockResolvedValue(undefined),
    } as const;
    let listener:
      | ((args: {
          event: {
            channel: string;
            ts: string;
            thread_ts?: string;
            text?: string;
            user?: string;
            subtype?: string;
          };
          say: (message: { text: string; thread_ts: string }) => Promise<unknown>;
        }) => Promise<void>)
      | undefined;
    const replies: Array<{ text: string; thread_ts: string }> = [];

    registerSlackMessageHandler(
      {
        event(_name, handler) {
          listener = handler;
        },
      },
      router as unknown as RouterService,
    );

    expect(listener).toBeDefined();

    await listener?.({
      event: {
        channel: "C08TEMPLATE",
        ts: "1710000000.0002",
        thread_ts: "1710000000.0001",
        text: "Use the narrower repro",
        user: "U123",
      },
      say: async (message) => {
        replies.push(message);
      },
    });

    expect(router.handleSlackMessage).toHaveBeenCalledWith({
      channelId: "C08TEMPLATE",
      messageTs: "1710000000.0002",
      threadTs: "1710000000.0001",
      text: "Use the narrower repro",
      userId: "U123",
      reply: expect.any(Function),
    });
    expect(replies).toEqual([]);

    const reply = (
      router.handleSlackMessage as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0].reply as (message: string) => Promise<void>;
    await reply("Continuing Codex task for project `template`.");

    expect(replies).toEqual([
      {
        text: "Continuing Codex task for project `template`.",
        thread_ts: "1710000000.0001",
      },
    ]);
  });
});
