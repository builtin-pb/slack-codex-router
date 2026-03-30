import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export type AppServerProcess = {
  child: ChildProcessWithoutNullStreams;
  writeLine(line: string): void;
  onLine(listener: (line: string) => void): () => void;
  waitForExit(): Promise<number | null>;
};

type SpawnAppServerProcessOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export function spawnAppServerProcess(
  command: readonly string[],
  options: SpawnAppServerProcessOptions = {},
): AppServerProcess {
  const [file, ...args] = command;

  if (!file) {
    throw new Error("App Server command must include an executable");
  }

  const child = spawn(file, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const lineReader = createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });
  const listeners = new Set<(line: string) => void>();
  const exitPromise = new Promise<number | null>((resolve, reject) => {
    const handleExit = (code: number | null) => {
      cleanup();
      resolve(code);
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      child.off("exit", handleExit);
      child.off("error", handleError);
    };

    child.once("exit", handleExit);
    child.once("error", handleError);
  });

  lineReader.on("line", (line) => {
    for (const listener of listeners) {
      listener(line);
    }
  });

  return {
    child,
    writeLine(line: string): void {
      child.stdin.write(`${line}\n`);
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
