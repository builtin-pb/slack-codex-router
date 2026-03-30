import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function runRouterSmoke() {
  const tempDir = mkdtempSync(join(tmpdir(), "router-bin-smoke-"));
  const missingProjectsFile = join(tempDir, "projects.yaml");
  const child = spawn(process.execPath, ["--import", "tsx", "src/bin/router.ts"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: {
      ...process.env,
      SLACK_BOT_TOKEN: "xoxb-smoke",
      SLACK_APP_TOKEN: "xapp-smoke",
      SLACK_ALLOWED_USER_ID: "U123",
      CODEX_APP_SERVER_COMMAND: "true",
      SCR_PROJECTS_FILE: missingProjectsFile,
      DOTENV_CONFIG_PATH: "/tmp/nonexistent.env",
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
    const result = (await Promise.race([
      once(child, "close"),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("router smoke timed out"));
        }, timeoutMs + 25);
      }),
    ])) as [number | null, NodeJS.Signals | null];

    return {
      exitCode: result[0],
      signal: result[1],
      missingProjectsFile,
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
    };
  } finally {
    clearTimeout(timeout);
    rmSync(tempDir, { recursive: true, force: true });
    child.kill("SIGKILL");
  }
}

describe("router entry smoke", () => {
  it("exits with the expected failure code and missing-projects error", async () => {
    const result = await runRouterSmoke();

    expect(result.exitCode).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.stdout).toContain("v2 router bootstrap ready for U123");
    expect(result.stdout).toContain("projects.yaml");
    expect(result.stderr).toContain(
      `Error: Router projects file is missing: ${result.missingProjectsFile}`,
    );
  });
});
