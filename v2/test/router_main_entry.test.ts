import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("router main entry", () => {
  const routerEntryPath = fileURLToPath(new URL("../src/bin/router.ts", import.meta.url));
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
    vi.doUnmock("node:fs");
    vi.doUnmock("../src/config.js");
    vi.doUnmock("dotenv");
  });

  it("logs the bootstrap failure and sets exitCode to 1 when imported as the main module", async () => {
    process.argv[1] = routerEntryPath;

    vi.doMock("dotenv", () => ({
      config: vi.fn(),
    }));
    vi.doMock("../src/config.js", () => ({
      repoRootPath: "/tmp/router-entry",
      loadConfig: vi.fn(() => ({
        allowedUserId: "UENTRY",
        projectsFile: "/tmp/router-entry/projects.yaml",
      })),
    }));
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        existsSync: vi.fn(() => false),
      };
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await import("../src/bin/router.js");
    await Promise.resolve();

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Router projects file is missing: /tmp/router-entry/projects.yaml",
      }),
    );
  });

  it("does not auto-run the bootstrap when imported as a non-main module", async () => {
    process.argv[1] = "/tmp/not-router-entry.js";
    process.exitCode = 7;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await import("../src/bin/router.js");
    await Promise.resolve();

    expect(process.exitCode).toBe(7);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
