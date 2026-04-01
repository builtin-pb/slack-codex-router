import { execFileSync } from "node:child_process";

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
export type MergeRunner = (input: {
  args: string[];
  cwd: string;
}) => Promise<{ stdout: string }>;

type HeadState =
  | { kind: "branch"; value: string }
  | { kind: "detached"; value: string }
  | null;

export function buildMergeConfirmation(input: {
  promptId?: number;
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
          value:
            input.promptId && Number.isInteger(input.promptId) && input.promptId > 0
              ? `${input.promptId}:${input.sourceBranch}:${input.targetBranch}`
              : `${input.sourceBranch}:${input.targetBranch}`,
          style: "primary",
        },
      ],
    },
  ];
}

export async function mergeBranchToTarget(input: {
  repoPath: string;
  sourceBranch: string;
  targetBranch: string;
  restoreOriginalHead?: boolean;
  run?: MergeRunner;
}): Promise<{ text: string }> {
  const run =
    input.run ??
    (async ({ args, cwd }: { args: string[]; cwd: string }) => ({
      stdout: execFileSync("git", args, {
        cwd,
        encoding: "utf8",
      }),
    }));

  const originalBranch = (
    await run({
      args: ["branch", "--show-current"],
      cwd: input.repoPath,
    })
  ).stdout.trim();
  const originalHead = await readHeadState(run, input.repoPath, originalBranch);
  const restoreOriginalHead = input.restoreOriginalHead ?? true;

  await run({
    args: ["checkout", input.targetBranch],
    cwd: input.repoPath,
  });

  try {
    await run({
      args: ["merge", "--no-ff", "--no-edit", input.sourceBranch],
      cwd: input.repoPath,
    });
  } catch (error) {
    try {
      await run({
        args: ["merge", "--abort"],
        cwd: input.repoPath,
      });
    } catch {
      // Best-effort cleanup only; preserve the original merge failure.
    }

    throw error;
  } finally {
    if (
      restoreOriginalHead &&
      originalHead &&
      (originalHead.kind === "detached" || originalHead.value !== input.targetBranch)
    ) {
      await run({
        args: ["checkout", originalHead.value],
        cwd: input.repoPath,
      });
    }
  }

  return {
    text: `Merged ${input.sourceBranch} into ${input.targetBranch}.`,
  };
}

async function readHeadState(
  run: MergeRunner,
  repoPath: string,
  originalBranch: string,
): Promise<HeadState> {
  if (originalBranch) {
    return { kind: "branch", value: originalBranch };
  }

  const detachedHead = (
    await run({
      args: ["rev-parse", "HEAD"],
      cwd: repoPath,
    })
  ).stdout.trim();

  return detachedHead ? { kind: "detached", value: detachedHead } : null;
}
