import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { createLauncherFixture } from "../helpers/launcher_fixture.js";

describe("launcher-mediated restart loop", () => {
  it(
    "restarts a worker after exit code 75 and runs a second generation",
    async () => {
    const fixture = await createLauncherFixture();

    try {
      const child = spawn(process.execPath, ["--import", fixture.tsxLoader, fixture.wrapperEntry], {
        cwd: fixture.repoRootPath,
        env: fixture.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      await fixture.waitForWorkerGeneration(1);
      await fixture.waitForWorkerGeneration(2);
      expect(await fixture.observedExitCodes()).toContain(75);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
    } finally {
      await fixture.cleanup();
    }
    },
    15000,
  );
});
