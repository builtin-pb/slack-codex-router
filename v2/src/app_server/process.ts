import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export type AppServerProcess = {
  child: ChildProcessWithoutNullStreams;
  writeLine(line: string): Promise<void>;
  onLine(listener: (line: string) => void): () => void;
  waitForExit(): Promise<number | null>;
};

type SpawnAppServerProcessOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdinWriteTimeoutMs?: number;
};

const DEFAULT_STDIN_WRITE_TIMEOUT_MS = 5_000;

export function spawnAppServerProcess(
  command: readonly string[],
  options: SpawnAppServerProcessOptions = {},
): AppServerProcess {
  const [file, ...args] = command;
  const stdinWriteTimeoutMs =
    options.stdinWriteTimeoutMs ?? DEFAULT_STDIN_WRITE_TIMEOUT_MS;

  if (!file) {
    throw new Error("App Server command must include an executable");
  }

  const child = spawn(file, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();

  const lineReader = createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });
  const listeners = new Set<(line: string) => void>();
  let stdinFailure: Error | null = null;
  const exitPromise = new Promise<number | null>((resolve, reject) => {
    let exitCode: number | null = null;
    let didExit = false;
    let stdoutClosed = false;

    const closeLineReader = () => {
      lineReader.close();
    };
    const maybeResolve = () => {
      if (!didExit || !stdoutClosed) {
        return;
      }

      child.off("error", handleError);
      resolve(exitCode);
    };
    const handleStdoutClose = () => {
      stdoutClosed = true;
      closeLineReader();
      maybeResolve();
    };
    const handleExit = (code: number | null) => {
      didExit = true;
      exitCode = code;
      maybeResolve();
    };
    const handleError = (error: Error) => {
      child.off("exit", handleExit);
      child.stdout.off("close", handleStdoutClose);
      closeLineReader();
      reject(error);
    };

    child.once("exit", handleExit);
    child.once("error", handleError);
    child.stdout.once("close", handleStdoutClose);
  });
  child.stdin.on("error", (error) => {
    stdinFailure ??= error;
  });

  lineReader.on("line", (line) => {
    for (const listener of listeners) {
      listener(line);
    }
  });

  return {
    child,
    writeLine(line: string): Promise<void> {
      if (stdinFailure) {
        return Promise.reject(stdinFailure);
      }

      return new Promise<void>((resolve, reject) => {
        let settled = false;
        let successHandle: ReturnType<typeof setImmediate> | null = null;
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
          if (successHandle) {
            clearImmediate(successHandle);
            successHandle = null;
          }
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }
          child.stdin.off("error", handleWriteError);
          child.stdin.off("drain", handleDrain);
          child.stdin.off("close", handleClose);
        };
        const settleSuccess = () => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          resolve();
        };
        const settleError = (error: Error) => {
          if (settled) {
            return;
          }

          settled = true;
          stdinFailure ??= error;
          cleanup();
          queueMicrotask(() => {
            reject(error);
          });
        };
        const handleWriteError = (error: Error) => {
          settleError(error);
        };
        const handleDrain = () => {
          settleSuccess();
        };
        const handleClose = () => {
          settleError(stdinFailure ?? new Error("App Server stdin closed"));
        };
        const startTimeout = () => {
          if (stdinWriteTimeoutMs <= 0) {
            return;
          }

          timeoutHandle = setTimeout(() => {
            timeoutHandle = null;
            settleError(new Error("App Server stdin write timed out"));
          }, stdinWriteTimeoutMs);
          timeoutHandle.unref?.();
        };

        child.stdin.on("error", handleWriteError);
        child.stdin.on("close", handleClose);

        let needsDrain = false;
        try {
          needsDrain = !child.stdin.write(`${line}\n`);
        } catch (error) {
          settleError(asError(error));
          return;
        }

        if (needsDrain) {
          child.stdin.on("drain", handleDrain);
          startTimeout();
          return;
        }

        successHandle = setImmediate(() => {
          settleSuccess();
        });
      });
    },
    onLine(listener: (line: string) => void): () => void {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    waitForExit(): Promise<number | null> {
      return exitPromise;
    },
  };
}

function asError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}
