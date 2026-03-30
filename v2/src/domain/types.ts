export const threadStates = [
  "idle",
  "running",
  "awaiting_user_input",
  "interrupted",
  "failed_setup",
] as const;

export type ThreadState = (typeof threadStates)[number];

export type ThreadRecord = {
  slackChannelId: string;
  slackThreadTs: string;
  appServerThreadId: string;
  state: ThreadState;
  worktreePath: string;
  branchName: string;
  baseBranch: string;
};

export type RestartIntent = {
  requestedByThreadTs: string;
  requestedAt: string;
};
