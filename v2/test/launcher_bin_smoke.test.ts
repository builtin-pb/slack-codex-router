import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const v2Root = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = join(v2Root, "src");

async function runLauncherSmoke() {
  const tempDir = mkdtempSync(join(tmpdir(), "launcher-bin-smoke-"));
  const tempSrcRoot = join(tempDir, "src");
  const tempBinDir = join(tempSrcRoot, "bin");
  const tempRuntimeDir = join(tempSrcRoot, "runtime");
  const tempLauncherPath = join(tempBinDir, "launcher.ts");
  const tempRuntimeLauncherPath = join(tempRuntimeDir, "launcher.ts");
  const tempRuntimeRestartPath = join(tempRuntimeDir, "restart.ts");
  const tempRouterPath = join(tempBinDir, "router.js");
  const tempRunnerPath = join(tempDir, "launcher-smoke.mjs");

  try {
    mkdirSync(tempBinDir, { recursive: true });
    mkdirSync(tempRuntimeDir, { recursive: true });
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ type: "module" }),
      "utf8",
    );

    copyFileSync(join(sourceRoot, "bin", "launcher.ts"), tempLauncherPath);
    copyFileSync(join(sourceRoot, "runtime", "launcher.ts"), tempRuntimeLauncherPath);
    copyFileSync(join(sourceRoot, "runtime", "restart.ts"), tempRuntimeRestartPath);
    writeFileSync(
      tempRouterPath,
      [
        "process.exitCode = 4;",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      tempRunnerPath,
      [
        `import { main } from "${pathToFileURL(tempLauncherPath).href}";`,
        "await main();",
      ].join("\n"),
      "utf8",
    );

    const child = spawn(process.execPath, ["--import", "tsx", tempRunnerPath], {
      cwd: v2Root,
      env: {
        ...process.env,
      },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timeoutMs = 5000;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);

    try {
      const [exitCode, signal] = (await Promise.race([
        once(child, "close"),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("launcher smoke timed out")), timeoutMs + 25);
        }),
      ])) as [number | null, NodeJS.Signals | null];

      return {
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      };
    } finally {
      clearTimeout(timeout);
      child.kill("SIGKILL");
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("launcher entry smoke", () => {
  it("executes the launcher entrypoint and propagates worker exit code", async () => {
    const result = await runLauncherSmoke();

    expect(result.exitCode).toBe(4);
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
  });
});
