import { describe, expect, it } from "vitest";
import { buildMergeConfirmation } from "../src/git/merge_to_main.js";

describe("buildMergeConfirmation", () => {
  it("builds a confirmation card before merging to main", () => {
    const blocks = buildMergeConfirmation({
      repositoryName: "template",
      sourceBranch: "codex/slack/1710000000-0001",
      targetBranch: "main",
      checksStatus: "passed",
      worktreeStatus: "clean",
    });

    expect(blocks[0]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: expect.stringContaining("Merge codex/slack/1710000000-0001 into main?"),
      },
    });
    expect(JSON.stringify(blocks)).toContain("template");
    expect(JSON.stringify(blocks)).toContain("passed");
    expect(JSON.stringify(blocks)).toContain("clean");
    expect(JSON.stringify(blocks)).toContain("Confirm merge");
    expect(JSON.stringify(blocks)).toContain("confirm_merge_to_main");
  });
});
