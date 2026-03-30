import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
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

    await launcher.runOnce();

    expect(launches).toEqual(["worker", "worker"]);
  });

  it("returns the final non-restart worker exit code", async () => {
    const launcher = buildLauncher({
      spawnWorker: async () => ({
        wait: async () => 1,
      }),
    });

    await expect(launcher.runOnce()).resolves.toBe(1);
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
