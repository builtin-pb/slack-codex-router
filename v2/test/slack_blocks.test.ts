import { describe, expect, it } from "vitest";
import { buildThreadControls, buildUserInputBlocks } from "../src/slack/blocks.js";

describe("slack blocks", () => {
  it("renders Codex choices as interactive buttons", () => {
    const blocks = buildUserInputBlocks({
      prompt: "Pick a plan",
      options: [
        { id: "a", label: "Option A" },
        { id: "b", label: "Option B" },
      ],
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Pick a plan",
      },
    });
    expect(blocks[1]).toMatchObject({
      type: "actions",
      elements: [
        expect.objectContaining({
          action_id: "codex_choice:a",
          text: expect.objectContaining({ text: "Option A" }),
          value: "a",
        }),
        expect.objectContaining({
          action_id: "codex_choice:b",
          text: expect.objectContaining({ text: "Option B" }),
          value: "b",
        }),
      ],
    });
  });

  it("renders thread controls conditionally from thread state", () => {
    const blocks = buildThreadControls({
      canInterrupt: true,
      interruptTurnId: "turn_abc",
      canReview: false,
      canMerge: true,
      mergeThreadId: "thread_abc",
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "actions",
      elements: [
        expect.objectContaining({ action_id: "status" }),
        expect.objectContaining({
          action_id: "interrupt",
          value: "interrupt:turn_abc",
        }),
        expect.objectContaining({ action_id: "what_changed" }),
        expect.objectContaining({ action_id: "open_diff" }),
        expect.objectContaining({
          action_id: "merge_to_main",
          value: "merge_to_main:thread_abc",
        }),
        expect.objectContaining({ action_id: "restart_router" }),
        expect.objectContaining({ action_id: "archive_task" }),
      ],
    });
    expect(JSON.stringify(blocks)).not.toContain("review");
  });
});
