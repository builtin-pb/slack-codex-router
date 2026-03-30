import { describe, expect, it, vi } from "vitest";
import type { RouterService } from "../src/router/service.js";
import { registerSlackMessageHandler } from "../src/slack/app.js";

describe("registerSlackMessageHandler", () => {
  it("ignores subtype events", async () => {
    const router = {
      handleSlackMessage: vi.fn(),
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
        ts: "1710000000.0001",
        text: "edited message",
        user: "U123",
        subtype: "message_changed",
      },
      say: vi.fn(),
    });

    expect(router.handleSlackMessage).not.toHaveBeenCalled();
  });
});
