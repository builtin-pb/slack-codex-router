import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RouterStore } from "../src/persistence/store.js";
import { RouterService } from "../src/router/service.js";

function createMalformedRegistryFixture(): {
  cleanup(): void;
  projectsFile: string;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "router-service-registry-"));
  const projectsFile = join(tempDir, "projects.yaml");

  mkdirSync(join(tempDir, "project"), { recursive: true });
  writeFileSync(
    projectsFile,
    `projects:\n  - channel_id: C08TEMPLATE\n    path: ${JSON.stringify(
      join(tempDir, "project"),
    )}\n`,
    "utf8",
  );

  return {
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
    projectsFile,
  };
}

describe("RouterService registry validation", () => {
  it("fails fast when a project registry entry is missing required fields", () => {
    const fixture = createMalformedRegistryFixture();
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
      ).toThrow(/project registry/i);
    } finally {
      store.close();
      fixture.cleanup();
    }
  });
});
