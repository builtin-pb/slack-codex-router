import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RouterStore } from "../src/persistence/store.js";
import { RouterService } from "../src/router/service.js";

function createDuplicateChannelFixture(): {
  cleanup(): void;
  projectsFile: string;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "router-service-duplicate-"));
  const projectDir = join(tempDir, "project");
  const projectsFile = join(tempDir, "projects.yaml");

  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    projectsFile,
    [
      "projects:",
      "  - channel_id: C08TEMPLATE",
      "    name: template-one",
      `    path: ${JSON.stringify(projectDir)}`,
      "  - channel_id: C08TEMPLATE",
      "    name: template-two",
      `    path: ${JSON.stringify(projectDir)}`,
      "",
    ].join("\n"),
    "utf8",
  );

  return {
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
    projectsFile,
  };
}

describe("RouterService duplicate channel validation", () => {
  it("fails fast when the registry repeats a channel id", () => {
    const fixture = createDuplicateChannelFixture();
    const store = new RouterStore(":memory:");

    try {
      expect(
        () =>
          new RouterService({
            allowedUserId: "U123",
            projectsFile: fixture.projectsFile,
            store,
            threadStart: async () => ({ threadId: "thread_abc" }),
            turnStart: async () => ({}),
          }),
      ).toThrow(/duplicate channel_id/i);
    } finally {
      store.close();
      fixture.cleanup();
    }
  });
});
