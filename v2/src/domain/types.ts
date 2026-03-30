export const threadStates = [
  "idle",
  "running",
  "awaiting_user_input",
  "interrupted",
  "failed_setup",
] as const;

export type ThreadState = (typeof threadStates)[number];

export type SlackThreadIdentity = {
  slackChannelId: string;
  slackThreadTs: string;
};

export type ThreadWorktree = {
  worktreePath: string;
  branchName: string;
  baseBranch: string;
};

export type ThreadRecord = {
  slackChannelId: string;
  slackThreadTs: string;
  appServerThreadId: string;
  activeTurnId?: string | null;
  appServerSessionStale?: boolean | null;
  state: ThreadState;
} & ThreadWorktree;

export type RestartIntent = SlackThreadIdentity & {
  requestedAt: string;
};
