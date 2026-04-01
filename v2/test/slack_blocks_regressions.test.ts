import { describe, expect, it } from "vitest";
import { buildThreadControls, buildUserInputBlocks } from "../src/slack/blocks.js";

describe("slack blocks regressions", () => {
  it("keeps only the always-available thread controls when optional flags are false", () => {
    const blocks = buildThreadControls({
      canInterrupt: false,
      canReview: false,
      canMerge: false,
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "actions",
      elements: [
        expect.objectContaining({ action_id: "status" }),
        expect.objectContaining({ action_id: "what_changed" }),
        expect.objectContaining({ action_id: "open_diff" }),
        expect.objectContaining({ action_id: "restart_router" }),
        expect.objectContaining({ action_id: "archive_task" }),
      ],
    });
    expect(JSON.stringify(blocks)).not.toContain("interrupt");
    expect(JSON.stringify(blocks)).not.toContain("review");
    expect(JSON.stringify(blocks)).not.toContain("merge_to_main");
  });

  it("keeps codex choice action ids and values stable for future handlers", () => {
    const blocks = buildUserInputBlocks({
      prompt: "Choose a path",
      options: [
        { id: "option-1", label: "Ship it" },
        { id: "option-2", label: "Revise" },
      ],
    });

    expect(blocks[1]).toMatchObject({
      type: "actions",
      elements: [
        expect.objectContaining({
          action_id: "codex_choice:option-1",
          value: "option-1",
          text: expect.objectContaining({ text: "Ship it" }),
        }),
        expect.objectContaining({
          action_id: "codex_choice:option-2",
          value: "option-2",
          text: expect.objectContaining({ text: "Revise" }),
        }),
      ],
    });
  });

  it("renders mutating controls with the identity tags they rely on", () => {
    const blocks = buildThreadControls({
      canInterrupt: true,
      canReview: true,
      canMerge: true,
      interruptTurnId: "turn_abc",
      reviewThreadId: "thread_review",
      mergeThreadId: "thread_merge",
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
          action_id: "review",
          value: "review:thread_review",
        }),
        expect.objectContaining({
          action_id: "merge_to_main",
          value: "merge_to_main:thread_merge",
        }),
        expect.objectContaining({ action_id: "restart_router" }),
        expect.objectContaining({ action_id: "archive_task" }),
      ],
    });
    expect(JSON.stringify(blocks)).toContain("interrupt:turn_abc");
    expect(JSON.stringify(blocks)).toContain("review:thread_review");
    expect(JSON.stringify(blocks)).toContain("merge_to_main:thread_merge");
  });
});
