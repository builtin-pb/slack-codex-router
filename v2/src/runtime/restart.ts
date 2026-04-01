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
  recoveredThreads: ThreadRecord[];
  notifyThreadTs: string | null;
  notifyChannelId: string | null;
}> {
  const recoveredThreads: ThreadRecord[] = input.recoverableThreads.map((thread) => ({
    ...thread,
    activeTurnId: null,
    appServerSessionStale: true,
    state: thread.state === "idle" ? "idle" : "interrupted",
  }));
  const pendingIntentMatchesRecoveredThread =
    input.pendingRestartIntent !== null &&
    recoveredThreads.some(
      (thread) =>
        thread.slackChannelId === input.pendingRestartIntent?.slackChannelId &&
        thread.slackThreadTs === input.pendingRestartIntent?.slackThreadTs,
    );

  return {
    recoveredThreadCount: recoveredThreads.length,
    recoveredThreads,
    notifyThreadTs: pendingIntentMatchesRecoveredThread
      ? input.pendingRestartIntent?.slackThreadTs ?? null
      : null,
    notifyChannelId: pendingIntentMatchesRecoveredThread
      ? input.pendingRestartIntent?.slackChannelId ?? null
      : null,
  };
}
