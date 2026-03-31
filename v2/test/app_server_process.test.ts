import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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

  it("returns the exit code even if the child exits before waitForExit is called", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "app-server-process-fast-exit-"));

    try {
      const scriptPath = join(tempDir, "fast-exit.mjs");
      writeFileSync(scriptPath, "process.exit(5);\n", "utf8");

      const appServer = spawnAppServerProcess([process.execPath, scriptPath], {
        cwd: tempDir,
      });

      await once(appServer.child, "exit");

      await expect(appServer.waitForExit()).resolves.toBe(5);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("drains stderr so a chatty child can still deliver stdout readiness", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "app-server-process-stderr-"));

    try {
      const scriptPath = join(tempDir, "stderr-backpressure.mjs");
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
          '  process.stdout.write("ready\\n", () => process.exit(0));',
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
      const lines: string[] = [];

      const unsubscribe = appServer.onLine((line) => {
        lines.push(line);
      });

      try {
        const timeout = Symbol("timeout");
        const readyResult = await Promise.race([
          (async () => {
            while (lines.length === 0) {
              await delay(10);
            }

            return lines[0];
          })(),
          delay(1_000, timeout),
        ]);

        expect(readyResult).toBe("ready");
        await expect(appServer.waitForExit()).resolves.toBe(0);
      } finally {
        unsubscribe();
        appServer.child.kill();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
