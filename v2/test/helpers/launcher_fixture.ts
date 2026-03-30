import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function createLauncherFixture() {
  const tempDir = mkdtempSync(join(tmpdir(), "router-launcher-fixture-"));
  const repoRootPath = fileURLToPath(new URL("../../..", import.meta.url));
  const sourceRoot = join(repoRootPath, "v2", "src");
  const tempSrcRoot = join(tempDir, "src");
  const tempRuntimeDir = join(tempSrcRoot, "runtime");
  const logFile = join(tempDir, "launcher.log");
  const workerScript = join(tempDir, "worker.mjs");
  const wrapperEntry = join(tempDir, "launcher-wrapper.mjs");
  const runtimeLauncherPath = join(tempRuntimeDir, "launcher.ts");
  const runtimeRestartPath = join(tempRuntimeDir, "restart.ts");

  mkdirSync(tempRuntimeDir, { recursive: true });
  writeFileSync(join(tempDir, "package.json"), JSON.stringify({ type: "module" }), "utf8");
  copyFileSync(join(sourceRoot, "runtime", "launcher.ts"), runtimeLauncherPath);
  copyFileSync(join(sourceRoot, "runtime", "restart.ts"), runtimeRestartPath);

  writeFileSync(
    workerScript,
    [
      'import { appendFileSync } from "node:fs";',
      'appendFileSync(process.env.LAUNCHER_TEST_LOG, `worker:${process.env.LAUNCHER_TEST_GENERATION}\\n`, "utf8");',
      'process.exit(process.env.LAUNCHER_TEST_GENERATION === "1" ? 75 : 0);',
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    wrapperEntry,
    [
      'import { spawn } from "node:child_process";',
      `import { buildLauncher } from ${JSON.stringify(pathToFileURL(runtimeLauncherPath).href)};`,
      "let generation = 0;",
      "const launcher = buildLauncher({",
      "  async spawnWorker() {",
      "    generation += 1;",
      "    const child = spawn(process.execPath, [process.env.LAUNCHER_TEST_WORKER], {",
      "      env: { ...process.env, LAUNCHER_TEST_GENERATION: String(generation) },",
      "      stdio: 'inherit',",
      "    });",
      "    return { wait: () => new Promise((resolve) => child.once('exit', (code) => resolve(code ?? 0))) };",
      "  },",
      "});",
      "const exitCode = await launcher.runOnce();",
      "process.exit(exitCode);",
    ].join("\n"),
    "utf8",
  );

  return {
    wrapperEntry,
    repoRootPath,
    tsxLoader: join(repoRootPath, "v2", "node_modules", "tsx", "dist", "loader.mjs"),
    env: {
      ...process.env,
      LAUNCHER_TEST_LOG: logFile,
      LAUNCHER_TEST_WORKER: workerScript,
    },
    async waitForWorkerGeneration(n: number) {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const count = safeReadFile(logFile)
          .split("\n")
          .filter((line) => line.startsWith("worker:")).length;
        if (count >= n) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`Timed out waiting for worker generation ${n}`);
    },
    async observedExitCodes() {
      return safeReadFile(logFile)
        .split("\n")
        .filter((line) => line.startsWith("worker:"))
        .map((line) => (line.endsWith("1") ? 75 : 0));
    },
    async cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function safeReadFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
