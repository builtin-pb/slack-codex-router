import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads the Slack env contract and v2 defaults", () => {
    const config = loadConfig({
      SLACK_BOT_TOKEN: "xoxb-test",
      SLACK_APP_TOKEN: "xapp-test",
      SLACK_ALLOWED_USER_ID: "U123",
      PROJECTS_FILE: "config/projects.example.yaml",
      ROUTER_STATE_DB: "tmp/router-v2.sqlite3",
    });

    expect(config.slackBotToken).toBe("xoxb-test");
    expect(config.slackAppToken).toBe("xapp-test");
    expect(config.allowedUserId).toBe("U123");
    expect(config.projectsFile).toContain("config/projects.example.yaml");
    expect(config.routerStateDb).toContain("tmp/router-v2.sqlite3");
    expect(config.appServerCommand).toEqual(["codex", "app-server"]);
  });
});
