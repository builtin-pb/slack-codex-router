import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const baseEnv = {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_APP_TOKEN: "xapp-test",
    SLACK_ALLOWED_USER_ID: "U123",
  };

  it("resolves repo-root aliases to absolute repo-root paths", () => {
    const config = loadConfig({
      ...baseEnv,
      SCR_PROJECTS_FILE: "config/projects.example.yaml",
      SCR_STATE_DB: "tmp/router-v2.sqlite3",
    });

    expect(config.slackBotToken).toBe("xoxb-test");
    expect(config.slackAppToken).toBe("xapp-test");
    expect(config.allowedUserId).toBe("U123");
    expect(config.projectsFile).toBe(
      resolve(repoRoot, "config/projects.example.yaml"),
    );
    expect(config.routerStateDb).toBe(resolve(repoRoot, "tmp/router-v2.sqlite3"));
    expect(config.appServerCommand).toEqual(["codex", "app-server"]);
  });

  it("resolves default project and state paths against the repo root", () => {
    const config = loadConfig(baseEnv);

    expect(config.projectsFile).toBe(resolve(repoRoot, "config/projects.yaml"));
    expect(config.routerStateDb).toBe(
      resolve(repoRoot, "logs/router-v2/state.sqlite3"),
    );
  });

  it("parses quoted app-server commands", () => {
    const config = loadConfig({
      ...baseEnv,
      SCR_PROJECTS_FILE: "config/projects.example.yaml",
      SCR_STATE_DB: "tmp/router-v2.sqlite3",
      CODEX_APP_SERVER_COMMAND: 'codex app-server --label "My Project"',
    });

    expect(config.appServerCommand).toEqual([
      "codex",
      "app-server",
      "--label",
      "My Project",
    ]);
  });
});
