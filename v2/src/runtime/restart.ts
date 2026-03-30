export const RESTART_EXIT_CODE = 75;

export function isRestartExitCode(exitCode: number): boolean {
  return exitCode === RESTART_EXIT_CODE;
}
