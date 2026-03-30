import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("router bootstrap", () => {
  it("loads env from DOTENV_CONFIG_PATH and logs repo-root resolved paths", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "router-bootstrap-"));
    const dotenvPath = join(tempDir, "custom.env");
    const previousCwd = process.cwd();
    const previousEnv = new Map<string, string | undefined>();
    const keysToClear = [
      "SLACK_BOT_TOKEN",
      "SLACK_APP_TOKEN",
      "SLACK_ALLOWED_USER_ID",
      "ALLOWED_SLACK_USER_ID",
      "SCR_PROJECTS_FILE",
      "PROJECTS_FILE",
      "SCR_STATE_DB",
      "ROUTER_STATE_DB",
      "CODEX_APP_SERVER_COMMAND",
      "DOTENV_CONFIG_PATH",
    ];
    const logs: string[] = [];

    writeFileSync(
      dotenvPath,
      [
        "SLACK_BOT_TOKEN=xoxb-bootstrap-test",
        "SLACK_APP_TOKEN=xapp-bootstrap-test",
        "SLACK_ALLOWED_USER_ID=U123",
        "SCR_PROJECTS_FILE=config/projects.example.yaml",
      ].join("\n"),
      "utf8",
    );

    try {
      for (const key of keysToClear) {
        previousEnv.set(key, process.env[key]);
        delete process.env[key];
      }

      process.env.DOTENV_CONFIG_PATH = dotenvPath;
      process.chdir(tempDir);

      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const { main } = await import("../src/bin/router.js");
        await expect(main()).rejects.toThrow("projects file is missing");
      } finally {
        console.log = originalLog;
      }
    } finally {
      process.chdir(previousCwd);
      for (const [key, value] of previousEnv) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(logs).toEqual([
      `v2 router bootstrap ready for U123 with ${resolve(
        repoRoot,
        "config/projects.example.yaml",
      )}`,
    ]);
  });
});
