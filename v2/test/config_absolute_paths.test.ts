import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig absolute path passthrough", () => {
  const baseEnv = {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_APP_TOKEN: "xapp-test",
    SLACK_ALLOWED_USER_ID: "U123",
  };

  it("keeps absolute project and state paths unchanged", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "router-config-absolute-"));
    const projectsFile = resolve(tempDir, "nested", "projects.yaml");
    const routerStateDb = resolve(tempDir, "nested", "state.sqlite3");

    try {
      const config = loadConfig({
        ...baseEnv,
        PROJECTS_FILE: projectsFile,
        ROUTER_STATE_DB: routerStateDb,
      });

      expect(config.projectsFile).toBe(projectsFile);
      expect(config.routerStateDb).toBe(routerStateDb);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
