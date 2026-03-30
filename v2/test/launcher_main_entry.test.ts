import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("launcher main entry", () => {
  const launcherEntryPath = fileURLToPath(new URL("../src/bin/launcher.ts", import.meta.url));
  const originalArgv1 = process.argv[1];
  const originalExitCode = process.exitCode;

  afterEach(() => {
    if (originalArgv1 === undefined) {
      delete process.argv[1];
    } else {
      process.argv[1] = originalArgv1;
    }
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("../src/runtime/launcher.js");
  });

  it("logs the launcher failure and sets exitCode to 1 when imported as the main module", async () => {
    process.argv[1] = launcherEntryPath;

    vi.doMock("../src/runtime/launcher.js", () => ({
      buildLauncher: vi.fn(() => ({
        runOnce: vi.fn().mockRejectedValue(new Error("launcher entry failed")),
      })),
    }));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await import("../src/bin/launcher.js");
    await Promise.resolve();

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "launcher entry failed",
      }),
    );
  });
});
