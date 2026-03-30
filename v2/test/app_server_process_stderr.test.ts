import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { spawnAppServerProcess } from "../src/app_server/process.js";

describe("spawnAppServerProcess stderr draining", () => {
  it("allows a stderr-heavy child to exit cleanly without stdout traffic", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "app-server-process-stderr-only-"));

    try {
      const scriptPath = join(tempDir, "stderr-only.mjs");
      writeFileSync(
        scriptPath,
        [
          'const chunk = "x".repeat(64 * 1024);',
          "let writes = 0;",
          "",
          "function pump() {",
          "  while (writes < 256) {",
          "    writes += 1;",
          "    if (!process.stderr.write(chunk)) {",
          '      process.stderr.once("drain", pump);',
          "      return;",
          "    }",
          "  }",
          "  process.exit(0);",
          "}",
          "",
          "pump();",
          "",
        ].join("\n"),
        "utf8",
      );

      const appServer = spawnAppServerProcess([process.execPath, scriptPath], {
        cwd: tempDir,
      });

      try {
        const timeout = Symbol("timeout");
        const result = await Promise.race([
          appServer.waitForExit(),
          delay(1_000, timeout),
        ]);

        expect(result).toBe(0);
      } finally {
        appServer.child.kill();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
