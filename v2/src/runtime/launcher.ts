import { isRestartExitCode } from "./restart.js";

export type WorkerHandle = {
  wait(): Promise<number>;
};

export type LauncherDeps = {
  spawnWorker(): Promise<WorkerHandle>;
};

export type Launcher = {
  runOnce(): Promise<number>;
};

export function buildLauncher(deps: LauncherDeps): Launcher {
  return {
    async runOnce(): Promise<number> {
      while (true) {
        const worker = await deps.spawnWorker();
        const exitCode = await worker.wait();

        if (!isRestartExitCode(exitCode)) {
          return exitCode;
        }
      }
    },
  };
}
