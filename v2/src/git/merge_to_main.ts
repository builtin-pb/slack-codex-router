type PlainText = {
  type: "plain_text";
  text: string;
};

type MarkdownText = {
  type: "mrkdwn";
  text: string;
};

type SectionBlock = {
  type: "section";
  text: MarkdownText;
};

type ContextBlock = {
  type: "context";
  elements: MarkdownText[];
};

type ActionsBlock = {
  type: "actions";
  elements: Array<{
    type: "button";
    action_id: string;
    text: PlainText;
    value: string;
    style?: "primary";
  }>;
};

export type MergeConfirmationBlock = SectionBlock | ContextBlock | ActionsBlock;

export function buildMergeConfirmation(input: {
  repositoryName: string;
  sourceBranch: string;
  targetBranch: string;
  checksStatus: string;
  worktreeStatus: string;
}): MergeConfirmationBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Merge ${input.sourceBranch} into ${input.targetBranch}?`,
      },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `Repo: ${input.repositoryName}` },
        { type: "mrkdwn", text: `Checks: ${input.checksStatus}` },
        { type: "mrkdwn", text: `Worktree: ${input.worktreeStatus}` },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: "confirm_merge_to_main",
          text: {
            type: "plain_text",
            text: "Confirm merge",
          },
          value: `${input.sourceBranch}:${input.targetBranch}`,
          style: "primary",
        },
      ],
    },
  ];
}
