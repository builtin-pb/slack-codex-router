import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const startRouterRuntime = vi.fn().mockResolvedValue(undefined);
const waitForExit = vi.fn().mockResolvedValue(0);
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

vi.mock("../src/router/service.js", () => ({
  RouterService: routerServiceConstructor,
}));

vi.mock("../src/persistence/store.js", () => ({
  RouterStore: class MockRouterStore {
    close(): void {}
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
    threadStart = vi.fn();
    turnStart = vi.fn();
    turnInterrupt = vi.fn();
    reviewStart = vi.fn();
  },
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
});
