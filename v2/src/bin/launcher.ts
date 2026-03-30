import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildLauncher, type WorkerHandle } from "../runtime/launcher.js";

const launcherDir = dirname(fileURLToPath(import.meta.url));
const routerEntry = resolve(launcherDir, "router.js");

type KillableProcess = {
  kill(signal: NodeJS.Signals): boolean;
};

type SignalSource = {
  on(event: NodeJS.Signals, listener: () => void): unknown;
  off(event: NodeJS.Signals, listener: () => void): unknown;
};

export const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export function installSignalForwarding(deps: {
  signalSource: SignalSource;
  getChildProcess(): KillableProcess | null;
}): () => void {
  const listeners = FORWARDED_SIGNALS.map((signal) => {
    const listener = () => {
      deps.getChildProcess()?.kill(signal);
    };
    deps.signalSource.on(signal, listener);
    return { signal, listener };
  });

  return () => {
    for (const { signal, listener } of listeners) {
      deps.signalSource.off(signal, listener);
    }
  };
}

function spawnRouterWorker(onChildProcess: (child: KillableProcess | null) => void): Promise<WorkerHandle> {
  const child = spawn(process.execPath, [routerEntry], {
    env: process.env,
    stdio: "inherit",
  });
  onChildProcess(child);

  return Promise.resolve({
    wait: () =>
      new Promise<number>((resolveExitCode, reject) => {
        const clearChildProcess = () => {
          onChildProcess(null);
        };

        child.once("error", (error) => {
          clearChildProcess();
          reject(error);
        });
        child.once("exit", (code) => {
          clearChildProcess();
          resolveExitCode(code ?? 1);
        });
      }),
  });
}

export async function main(): Promise<void> {
  let activeChild: KillableProcess | null = null;
  const cleanupSignalForwarding = installSignalForwarding({
    signalSource: process,
    getChildProcess: () => activeChild,
  });
  const launcher = buildLauncher({
    spawnWorker: () =>
      spawnRouterWorker((child) => {
        activeChild = child;
      }),
  });

  try {
    process.exitCode = await launcher.runOnce();
  } finally {
    cleanupSignalForwarding();
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
