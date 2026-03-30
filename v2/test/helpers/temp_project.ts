import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createTempProjectFixture() {
  const tempDir = mkdtempSync(join(tmpdir(), "v2-runtime-harness-"));
  const projectDir = join(tempDir, "project");
  const projectsFile = join(tempDir, "projects.yaml");
  const routerStateDb = join(tempDir, "router.sqlite3");

  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    projectsFile,
    [
      "projects:",
      "  - channel_id: C08TEMPLATE",
      "    name: template",
      `    path: ${JSON.stringify(projectDir)}`,
    ].join("\n"),
    "utf8",
  );

  return {
    projectDir,
    projectsFile,
    routerStateDb,
    config: {
      slackBotToken: "xoxb-test",
      slackAppToken: "xapp-test",
      allowedUserId: "U123",
      projectsFile,
      routerStateDb,
      appServerCommand: ["codex", "app-server"],
    },
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}
