import type { RestartIntent, ThreadRecord } from "../domain/types.js";

export const RESTART_EXIT_CODE = 75;

export function isRestartExitCode(exitCode: number): boolean {
  return exitCode === RESTART_EXIT_CODE;
}

export async function requestRouterRestart(input: {
  store: {
    recordRestartIntent(intent: RestartIntent): void;
  };
  slackChannelId: string;
  slackThreadTs: string;
  requestedAt?: string;
}): Promise<{ exitCode: number }> {
  input.store.recordRestartIntent({
    slackChannelId: input.slackChannelId,
    slackThreadTs: input.slackThreadTs,
    requestedAt: input.requestedAt ?? new Date().toISOString(),
  });

  return { exitCode: RESTART_EXIT_CODE };
}

export async function recoverAfterRestart(input: {
  pendingRestartIntent: RestartIntent | null;
  recoverableThreads: ThreadRecord[];
}): Promise<{
  recoveredThreadCount: number;
  notifyThreadTs: string | null;
  notifyChannelId: string | null;
}> {
  return {
    recoveredThreadCount: input.recoverableThreads.length,
    notifyThreadTs: input.pendingRestartIntent?.slackThreadTs ?? null,
    notifyChannelId: input.pendingRestartIntent?.slackChannelId ?? null,
  };
}
