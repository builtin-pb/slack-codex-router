import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installSignalForwarding } from "../src/bin/launcher.js";
import { buildLauncher } from "../src/runtime/launcher.js";

describe("buildLauncher", () => {
  it("restarts the worker after a requested graceful exit", async () => {
    const launches: string[] = [];
    const launcher = buildLauncher({
      spawnWorker: async () => {
        launches.push("worker");
        return {
          wait: async () =>
            launches.length === 1 ? 75 : 0,
        };
      },
    });

    const exitCode = await launcher.runOnce();

    expect(launches).toEqual(["worker", "worker"]);
    expect(exitCode).toBe(0);
  });

  it("returns the final non-restart worker exit code", async () => {
    const launcher = buildLauncher({
      spawnWorker: async () => ({
        wait: async () => 4,
      }),
    });

    await expect(launcher.runOnce()).resolves.toBe(4);
  });
});

describe("installSignalForwarding", () => {
  it("forwards termination signals to the active child worker", () => {
    const signalSource = new EventEmitter();
    const forwarded: NodeJS.Signals[] = [];
    const cleanup = installSignalForwarding({
      signalSource,
      getChildProcess: () => ({
        kill: (signal: NodeJS.Signals) => {
          forwarded.push(signal);
          return true;
        },
      }),
    });

    signalSource.emit("SIGTERM");
    signalSource.emit("SIGINT");
    cleanup();
    signalSource.emit("SIGTERM");

    expect(forwarded).toEqual(["SIGTERM", "SIGINT"]);
  });
});

describe("launcher main", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("node:child_process");
    vi.doUnmock("../src/runtime/launcher.js");
  });

  it("spawns the router worker and assigns its exit code", async () => {
    const child = new EventEmitter() as EventEmitter & {
      kill(signal: NodeJS.Signals): boolean;
      once: EventEmitter["once"];
    };
    child.kill = vi.fn(() => true);

    const spawn = vi.fn(() => child);
    const buildLauncherMock = vi.fn(({ spawnWorker }: { spawnWorker(): Promise<{ wait(): Promise<number> }> }) => ({
      runOnce: async () => {
        const worker = await spawnWorker();
        queueMicrotask(() => {
          child.emit("exit", 7);
        });
        return worker.wait();
      },
    }));

    vi.doMock("node:child_process", () => ({
      spawn,
    }));
    vi.doMock("../src/runtime/launcher.js", () => ({
      buildLauncher: buildLauncherMock,
    }));

    const onSpy = vi.spyOn(process, "on");
    const offSpy = vi.spyOn(process, "off");
    const launcherModuleId = "../src/bin/launcher.js?main-spawn-worker";
    const { main } = await import(/* @vite-ignore */ launcherModuleId);

    await main();

    expect(buildLauncherMock).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringMatching(/src\/bin\/router\.js$/)],
      expect.objectContaining({
        env: process.env,
        stdio: "inherit",
      }),
    );
    expect(process.exitCode).toBe(7);
    expect(onSpy).toHaveBeenCalledTimes(2);
    expect(offSpy).toHaveBeenCalledTimes(2);
  });

  it("clears signal forwarding cleanly when the spawned worker emits an error", async () => {
    const child = new EventEmitter() as EventEmitter & {
      kill(signal: NodeJS.Signals): boolean;
      once: EventEmitter["once"];
    };
    child.kill = vi.fn(() => true);

    const spawn = vi.fn(() => child);
    const buildLauncherMock = vi.fn(({ spawnWorker }: { spawnWorker(): Promise<{ wait(): Promise<number> }> }) => ({
      runOnce: async () => {
        const worker = await spawnWorker();
        queueMicrotask(() => {
          child.emit("error", new Error("worker crashed"));
        });
        return worker.wait();
      },
    }));

    vi.doMock("node:child_process", () => ({
      spawn,
    }));
    vi.doMock("../src/runtime/launcher.js", () => ({
      buildLauncher: buildLauncherMock,
    }));

    const onSpy = vi.spyOn(process, "on");
    const offSpy = vi.spyOn(process, "off");
    const launcherModuleId = "../src/bin/launcher.js?main-child-error";
    const { main } = await import(/* @vite-ignore */ launcherModuleId);

    await expect(main()).rejects.toThrow("worker crashed");

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(onSpy).toHaveBeenCalledTimes(2);
    expect(offSpy).toHaveBeenCalledTimes(2);
  });

  it("removes forwarded signal handlers when launcher.runOnce rejects", async () => {
    const buildLauncherMock = vi.fn(() => ({
      runOnce: vi.fn().mockRejectedValue(new Error("launcher failed")),
    }));

    vi.doMock("../src/runtime/launcher.js", () => ({
      buildLauncher: buildLauncherMock,
    }));

    const onSpy = vi.spyOn(process, "on");
    const offSpy = vi.spyOn(process, "off");
    const launcherModuleId = "../src/bin/launcher.js?main-cleanup";
    const { main } = await import(/* @vite-ignore */ launcherModuleId);

    await expect(main()).rejects.toThrow("launcher failed");

    expect(onSpy).toHaveBeenCalledTimes(2);
    expect(offSpy).toHaveBeenCalledTimes(2);
  });
});
