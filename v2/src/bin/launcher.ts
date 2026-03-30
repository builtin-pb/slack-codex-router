import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildLauncher, type WorkerHandle } from "../runtime/launcher.js";

const launcherDir = dirname(fileURLToPath(import.meta.url));
const routerEntry = resolve(launcherDir, "router.js");

function spawnRouterWorker(): Promise<WorkerHandle> {
  const child = spawn(process.execPath, [routerEntry], {
    env: process.env,
    stdio: "inherit",
  });

  return Promise.resolve({
    wait: () =>
      new Promise<number>((resolveExitCode, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => {
          resolveExitCode(code ?? 1);
        });
      }),
  });
}

export async function main(): Promise<void> {
  const launcher = buildLauncher({
    spawnWorker: spawnRouterWorker,
  });

  await launcher.runOnce();
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
