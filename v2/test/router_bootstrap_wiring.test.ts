import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { repoRootPath } from "../src/config.js";

const startRouterRuntime = vi.fn().mockResolvedValue(undefined);
const waitForExit = vi.fn().mockResolvedValue(0);
const registerSlackMessageHandler = vi.fn();
const storeClose = vi.fn();
const threadStart = vi.fn().mockResolvedValue({ threadId: "thread_abc" });
const turnStart = vi.fn().mockResolvedValue({ turnId: "turn_abc" });
const turnInterrupt = vi.fn().mockResolvedValue(undefined);
const reviewStart = vi.fn().mockResolvedValue({ reviewId: "review_abc" });
const requestRouterRestart = vi.fn().mockResolvedValue({
  exitCode: 75,
  message: "Router restart requested.",
});
const execFileAsync = vi.fn(async (_file: string, _args: string[], _options: { cwd: string }) => ({
  stdout: "",
  stderr: "",
}));
const execFile = Object.assign(
  vi.fn(),
  {
    [Symbol.for("nodejs.util.promisify.custom")]: execFileAsync,
  },
);
const spawnAppServerProcess = vi.fn(() => ({
  writeLine: vi.fn(),
  onLine: vi.fn().mockReturnValue(() => {}),
  waitForExit,
}));
const routerServiceConstructor = vi.fn().mockImplementation((options) => ({
  options,
}));

vi.mock("@slack/bolt", () => ({
  App: class MockApp {
    client = {
      chat: {
        postMessage: vi.fn(),
      },
    };

    event = vi.fn();
    action = vi.fn();
  },
}));

vi.mock("../src/router/runtime.js", () => ({
  startRouterRuntime,
}));

vi.mock("../src/app_server/process.js", () => ({
  spawnAppServerProcess,
}));

vi.mock("node:child_process", () => ({
  execFile,
}));

vi.mock("../src/router/service.js", () => ({
  RouterService: routerServiceConstructor,
}));

vi.mock("../src/persistence/store.js", () => ({
  RouterStore: class MockRouterStore {
    close(): void {
      storeClose();
    }
    recordRestartIntent = vi.fn();
  },
}));

vi.mock("../src/app_server/client.js", () => ({
  AppServerClient: class MockAppServerClient {
    events = {
      subscribe: vi.fn().mockReturnValue(() => {}),
    };

    initialize = vi.fn().mockResolvedValue(undefined);
    handleLine = vi.fn();
    failPendingRequests = vi.fn();
    threadStart = threadStart;
    turnStart = turnStart;
    turnInterrupt = turnInterrupt;
    reviewStart = reviewStart;
  },
}));

vi.mock("../src/slack/app.js", () => ({
  registerSlackMessageHandler,
}));

vi.mock("../src/runtime/restart.js", () => ({
  requestRouterRestart,
}));

describe("router bootstrap wiring", () => {
  const previousEnv = new Map<string, string | undefined>();
  const keysToClear = [
    "SLACK_BOT_TOKEN",
    "SLACK_APP_TOKEN",
    "SLACK_ALLOWED_USER_ID",
    "ALLOWED_SLACK_USER_ID",
    "SCR_PROJECTS_FILE",
    "PROJECTS_FILE",
    "SCR_STATE_DB",
    "ROUTER_STATE_DB",
    "CODEX_APP_SERVER_COMMAND",
    "DOTENV_CONFIG_PATH",
  ];

  afterEach(() => {
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    previousEnv.clear();
    startRouterRuntime.mockClear();
    waitForExit.mockClear();
    spawnAppServerProcess.mockClear();
    routerServiceConstructor.mockClear();
    registerSlackMessageHandler.mockReset();
    storeClose.mockReset();
    threadStart.mockClear();
    turnStart.mockClear();
    turnInterrupt.mockClear();
    reviewStart.mockClear();
    requestRouterRestart.mockClear();
    execFile.mockClear();
    execFileAsync.mockClear();
    vi.resetModules();
  });

  it("passes a thread worktree allocator into RouterService", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "router-bootstrap-wiring-"));
    const dotenvPath = join(tempDir, "router.env");
    const projectsPath = join(tempDir, "projects.yaml");

    writeFileSync(
      dotenvPath,
      [
        "SLACK_BOT_TOKEN=xoxb-bootstrap-test",
        "SLACK_APP_TOKEN=xapp-bootstrap-test",
        "SLACK_ALLOWED_USER_ID=U123",
        `SCR_PROJECTS_FILE=${projectsPath}`,
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      projectsPath,
      [
        "projects:",
        "  - channel_id: C08TEMPLATE",
        "    name: template",
        `    path: ${JSON.stringify(tempDir)}`,
      ].join("\n"),
      "utf8",
    );

    try {
      for (const key of keysToClear) {
        previousEnv.set(key, process.env[key]);
        delete process.env[key];
      }

      process.env.DOTENV_CONFIG_PATH = dotenvPath;

      const { main } = await import("../src/bin/router.js");
      await main();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(routerServiceConstructor).toHaveBeenCalledTimes(1);
    expect(routerServiceConstructor.mock.calls[0]?.[0]).toMatchObject({
      allowedUserId: "U123",
      projectsFile: projectsPath,
      ensureThreadWorktree: expect.any(Function),
    });
  });

  it("spawns the app server from the repo root with the parsed command and live env", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "router-bootstrap-spawn-"));
    const dotenvPath = join(tempDir, "router.env");
    const projectsPath = join(tempDir, "projects.yaml");

    writeFileSync(
      dotenvPath,
      [
        "SLACK_BOT_TOKEN=xoxb-bootstrap-test",
        "SLACK_APP_TOKEN=xapp-bootstrap-test",
        "SLACK_ALLOWED_USER_ID=U123",
        `SCR_PROJECTS_FILE=${projectsPath}`,
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      projectsPath,
      [
        "projects:",
        "  - channel_id: C08TEMPLATE",
        "    name: template",
        `    path: ${JSON.stringify(tempDir)}`,
      ].join("\n"),
      "utf8",
    );

    try {
      for (const key of keysToClear) {
        previousEnv.set(key, process.env[key]);
        delete process.env[key];
      }

      process.env.DOTENV_CONFIG_PATH = dotenvPath;
      process.env.CODEX_APP_SERVER_COMMAND =
        "codex app-server --label 'My Project'";

      const { main } = await import("../src/bin/router.js");
      await main();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(spawnAppServerProcess).toHaveBeenCalledTimes(1);
    expect(spawnAppServerProcess.mock.calls[0]?.[0]).toEqual([
      "codex",
      "app-server",
      "--label",
      "My Project",
    ]);
    expect(spawnAppServerProcess.mock.calls[0]?.[1]).toMatchObject({
      cwd: repoRootPath,
    });
    expect(spawnAppServerProcess.mock.calls[0]?.[1]?.env).toBe(process.env);
  });

  it("wires Slack control actions through the bootstrap wrapper and closes the store", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "router-bootstrap-wrapper-"));
    const dotenvPath = join(tempDir, "router.env");
    const projectsPath = join(tempDir, "projects.yaml");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      return code === undefined ? undefined : Number(code);
    }) as typeof process.exit);

    vi.useFakeTimers();
    registerSlackMessageHandler.mockImplementation((_app, _router, options) => {
      options?.requestProcessExit?.(75);
    });
    startRouterRuntime.mockImplementation(async (input) => {
      input.registerSlackMessageHandler({ event: vi.fn(), action: vi.fn() }, {});
    });

    writeFileSync(
      dotenvPath,
      [
        "SLACK_BOT_TOKEN=xoxb-bootstrap-test",
        "SLACK_APP_TOKEN=xapp-bootstrap-test",
        "SLACK_ALLOWED_USER_ID=U123",
        `SCR_PROJECTS_FILE=${projectsPath}`,
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      projectsPath,
      [
        "projects:",
        "  - channel_id: C08TEMPLATE",
        "    name: template",
        `    path: ${JSON.stringify(tempDir)}`,
      ].join("\n"),
      "utf8",
    );

    try {
      for (const key of keysToClear) {
        previousEnv.set(key, process.env[key]);
        delete process.env[key];
      }

      process.env.DOTENV_CONFIG_PATH = dotenvPath;

      const { main } = await import("../src/bin/router.js");
      await main();
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
      rmSync(tempDir, { recursive: true, force: true });
    }

    expect(registerSlackMessageHandler).toHaveBeenCalledTimes(1);
    expect(registerSlackMessageHandler.mock.calls[0]?.[2]).toEqual({
      requestProcessExit: expect.any(Function),
    });
    expect(process.exitCode).toBe(75);
    expect(exitSpy).toHaveBeenCalledWith(75);
    expect(storeClose).toHaveBeenCalledTimes(1);
  });

  it("proxies router service delegates into the app server, git helpers, and restart handler", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "router-bootstrap-delegates-"));
    const dotenvPath = join(tempDir, "router.env");
    const projectsPath = join(tempDir, "projects.yaml");

    writeFileSync(
      dotenvPath,
      [
        "SLACK_BOT_TOKEN=xoxb-bootstrap-test",
        "SLACK_APP_TOKEN=xapp-bootstrap-test",
        "SLACK_ALLOWED_USER_ID=U123",
        `SCR_PROJECTS_FILE=${projectsPath}`,
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      projectsPath,
      [
        "projects:",
        "  - channel_id: C08TEMPLATE",
        "    name: template",
        `    path: ${JSON.stringify(tempDir)}`,
      ].join("\n"),
      "utf8",
    );

    try {
      for (const key of keysToClear) {
        previousEnv.set(key, process.env[key]);
        delete process.env[key];
      }

      process.env.DOTENV_CONFIG_PATH = dotenvPath;

      const { main } = await import("../src/bin/router.js");
      await main();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    const options = routerServiceConstructor.mock.calls[0]?.[0];
    expect(options).toBeDefined();

    await options.threadStart({ cwd: "/repo/project" });
    await options.turnStart({
      cwd: "/repo/project",
      prompt: "inspect this repo",
      threadId: "thread_existing",
    });
    await options.turnInterrupt({
      threadId: "thread_existing",
      turnId: "turn_existing",
    });
    await options.reviewStart({
      threadId: "thread_existing",
      target: { type: "uncommittedChanges" },
    });
    await options.requestRestart({
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
    });
    await options.getRepositoryStatus({
      repoPath: "/repo/project",
      sourceBranch: "feature/test",
      targetBranch: "main",
    });
    await options.executeMergeToMain({
      repoPath: "/repo/project",
      sourceBranch: "feature/test",
      targetBranch: "main",
    });

    expect(threadStart).toHaveBeenCalledWith({ cwd: "/repo/project" });
    expect(turnStart).toHaveBeenCalledWith({
      cwd: "/repo/project",
      prompt: "inspect this repo",
      threadId: "thread_existing",
    });
    expect(turnInterrupt).toHaveBeenCalledWith({
      threadId: "thread_existing",
      turnId: "turn_existing",
    });
    expect(reviewStart).toHaveBeenCalledWith({
      threadId: "thread_existing",
      target: { type: "uncommittedChanges" },
    });
    expect(requestRouterRestart).toHaveBeenCalledWith({
      store: expect.any(Object),
      slackChannelId: "C08TEMPLATE",
      slackThreadTs: "1710000000.0001",
    });
    expect(execFileAsync).toHaveBeenNthCalledWith(1, "git", ["status", "--porcelain"], {
      cwd: "/repo/project",
    });
    expect(execFileAsync).toHaveBeenNthCalledWith(2, "git", ["checkout", "main"], {
      cwd: "/repo/project",
    });
    expect(execFileAsync).toHaveBeenNthCalledWith(
      3,
      "git",
      ["merge", "--no-ff", "--no-edit", "feature/test"],
      {
        cwd: "/repo/project",
      },
    );
  });
});
