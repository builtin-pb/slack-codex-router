import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

describe("router bootstrap missing projects", () => {
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

  afterEach(() => {
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    previousEnv.clear();
  });

  it("fails hard when the configured projects file is missing", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "router-bootstrap-missing-projects-"));
    const dotenvPath = join(tempDir, "missing-projects.env");
    const missingProjectsPath = join(tempDir, "projects.yaml");

    writeFileSync(
      dotenvPath,
      [
        "SLACK_BOT_TOKEN=xoxb-bootstrap-test",
        "SLACK_APP_TOKEN=xapp-bootstrap-test",
        "SLACK_ALLOWED_USER_ID=U123",
        `SCR_PROJECTS_FILE=${missingProjectsPath}`,
      ].join("\n"),
      "utf8",
    );

    try {
      for (const key of keysToClear) {
        previousEnv.set(key, process.env[key]);
        delete process.env[key];
      }

      process.env.DOTENV_CONFIG_PATH = dotenvPath;

      const { main } = await import("../src/bin/router.js");

      await expect(main()).rejects.toThrow("projects file is missing");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
