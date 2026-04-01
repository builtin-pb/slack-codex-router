import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("spawnAppServerProcess readline cleanup", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("node:child_process");
    vi.doUnmock("node:readline");
  });

  it("waits for stdout close before resolving exit and closing readline", async () => {
    const lineReader = {
      close: vi.fn(),
      on: vi.fn(),
    };
    const stderr = new PassThrough();
    const stderrResume = vi.spyOn(stderr, "resume").mockImplementation(() => stderr);
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr,
      stdin: Object.assign(new EventEmitter(), {
        write: vi.fn().mockReturnValue(true),
      }),
    });
    const spawn = vi.fn(() => child);
    const createInterface = vi.fn(() => lineReader);

    vi.doMock("node:child_process", () => ({ spawn }));
    vi.doMock("node:readline", () => ({ createInterface }));

    const { spawnAppServerProcess } = await import("../src/app_server/process.js");
    const appServer = spawnAppServerProcess([process.execPath, "fake-app-server.mjs"]);
    const exitPromise = appServer.waitForExit();
    let resolved = false;
    exitPromise.then(() => {
      resolved = true;
    });

    child.emit("exit", 0);

    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(stderrResume).toHaveBeenCalledTimes(1);
    expect(lineReader.close).not.toHaveBeenCalled();

    child.stdout.emit("close");
    await expect(exitPromise).resolves.toBe(0);
    expect(lineReader.close).toHaveBeenCalledTimes(1);
  });
});
