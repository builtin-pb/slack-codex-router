import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig, resolveRepoRootPathFromModuleDir } from "../src/config.js";

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

  it("resolves SCR_STATE_DB relative to the repo root", () => {
    const config = loadConfig({
      ...baseEnv,
      SCR_STATE_DB: "state/router.sqlite3",
    });

    expect(config.routerStateDb).toBe(resolve(repoRoot, "state/router.sqlite3"));
  });

  it("preserves absolute project and state database paths", () => {
    const config = loadConfig({
      ...baseEnv,
      PROJECTS_FILE: "/tmp/projects.yaml",
      ROUTER_STATE_DB: "/var/tmp/router.sqlite3",
    });

    expect(config.projectsFile).toBe("/tmp/projects.yaml");
    expect(config.routerStateDb).toBe("/var/tmp/router.sqlite3");
  });

  it("derives the repo root from both source and compiled module directories", () => {
    expect(resolveRepoRootPathFromModuleDir(resolve(repoRoot, "v2", "src"))).toBe(
      repoRoot,
    );
    expect(
      resolveRepoRootPathFromModuleDir(resolve(repoRoot, "v2", "dist", "src")),
    ).toBe(repoRoot);
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

  it("parses escaped spaces and quoted segments in app-server commands", () => {
    const config = loadConfig({
      ...baseEnv,
      SCR_PROJECTS_FILE: "config/projects.example.yaml",
      SCR_STATE_DB: "tmp/router-v2.sqlite3",
      CODEX_APP_SERVER_COMMAND: String.raw`codex app-server --label 'My Project' --path path\ with\ spaces --note "A \"quoted\" value"`,
    });

    expect(config.appServerCommand).toEqual([
      "codex",
      "app-server",
      "--label",
      "My Project",
      "--path",
      "path with spaces",
      "--note",
      'A "quoted" value',
    ]);
  });

  it("fails fast when the app-server command is blank", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        CODEX_APP_SERVER_COMMAND: "   ",
      }),
    ).toThrow("CODEX_APP_SERVER_COMMAND must include an executable");
  });

  it("rejects app-server commands with an unterminated escape", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        CODEX_APP_SERVER_COMMAND: "codex app-server " + "\\",
      }),
    ).toThrow("Unterminated escape in CODEX_APP_SERVER_COMMAND");
  });

  it("rejects app-server commands with an unterminated quote", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        CODEX_APP_SERVER_COMMAND: 'codex app-server "My Project',
      }),
    ).toThrow("Unterminated quote in CODEX_APP_SERVER_COMMAND");
  });

  it("rejects missing slack bot tokens", () => {
    expect(() =>
      loadConfig({
        SLACK_APP_TOKEN: "xapp-test",
        SLACK_ALLOWED_USER_ID: "U123",
      }),
    ).toThrow("Missing required environment variable: SLACK_BOT_TOKEN");
  });

  it("rejects missing allowed user ids", () => {
    expect(() =>
      loadConfig({
        SLACK_BOT_TOKEN: "xoxb-test",
        SLACK_APP_TOKEN: "xapp-test",
      }),
    ).toThrow(
      "Missing required environment variable: one of SLACK_ALLOWED_USER_ID, ALLOWED_SLACK_USER_ID",
    );
  });
});
