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
});
