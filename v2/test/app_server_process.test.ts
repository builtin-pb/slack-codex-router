import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { spawnAppServerProcess } from "../src/app_server/process.js";

describe("spawnAppServerProcess", () => {
  it("delivers stdout lines, appends stdin newlines, and resolves waitForExit", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "app-server-process-"));

    try {
      const scriptPath = join(tempDir, "echo-and-exit.mjs");
      writeFileSync(
        scriptPath,
        [
          'import { createInterface } from "node:readline";',
          "",
          "const rl = createInterface({ input: process.stdin });",
          "",
          'rl.on("line", (line) => {',
          '  process.stdout.write(`echo:${line}\\n`, () => {',
          "    process.exit(7);",
          "  });",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );

      const appServer = spawnAppServerProcess([process.execPath, scriptPath], {
        cwd: tempDir,
      });
      const lines: string[] = [];

      const unsubscribe = appServer.onLine((line) => {
        lines.push(line);
      });

      try {
        const exitPromise = appServer.waitForExit();

        appServer.writeLine("hello");

        await expect(exitPromise).resolves.toBe(7);
        expect(lines).toEqual(["echo:hello"]);
      } finally {
        unsubscribe();
        appServer.child.kill();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
