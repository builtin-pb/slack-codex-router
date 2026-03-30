import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppServerClient } from "../../src/app_server/client.js";
import { spawnAppServerProcess } from "../../src/app_server/process.js";
import { RouterStore } from "../../src/persistence/store.js";
import { startRouterRuntime } from "../../src/router/runtime.js";
import { RouterService } from "../../src/router/service.js";
import { registerSlackMessageHandler } from "../../src/slack/app.js";
import { buildBranchName, buildWorktreePath } from "../../src/worktree/manager.js";
import { createFakeSlackApp } from "./fake_slack_app.js";
import { createTempProjectFixture } from "./temp_project.js";

type RealAppServerScenario =
  | "happy-path"
  | "fragmented-output"
  | "coalesced-output"
  | "exit-during-turn-start";

type LoggedRequest = Record<string, unknown> & {
  method?: string;
};

type DispatchMessageInput = {
  user: string;
  channel: string;
  ts: string;
  text: string;
};

export async function createRealAppServerHarness(options: {
  scenario: RealAppServerScenario;
}): Promise<{
  slack: ReturnType<typeof createFakeSlackApp>;
  store: RouterStore;
  processExitCodes: number[];
  waitForRequest(
    method: string,
    options?: { occurrence?: number },
  ): Promise<LoggedRequest>;
  waitForSlackMessage(options?: { occurrence?: number }): Promise<Record<string, unknown>>;
  dispatchTopLevelMessage(input: DispatchMessageInput): Promise<void>;
  dispatchAction(actionId: string, body: Record<string, unknown>): Promise<void>;
  cleanup(): Promise<void>;
}> {
  const project = createTempProjectFixture();
  const repoRootPath = fileURLToPath(new URL("../../..", import.meta.url));
  const slack = createFakeSlackApp();
  const store = new RouterStore(project.routerStateDb);
  const requestLogDir = mkdtempSync(join(tmpdir(), "router-real-app-server-"));
  const requestLogPath = join(requestLogDir, "requests.ndjson");
  const scriptPath = resolve(repoRootPath, "v2/test/fixtures/app_server_stub.mjs");
  const appServerProcess = spawnAppServerProcess([process.execPath, scriptPath], {
    cwd: repoRootPath,
    env: {
      ...process.env,
      APP_SERVER_STUB_SCENARIO: options.scenario,
      APP_SERVER_STUB_REQUEST_LOG: requestLogPath,
      APP_SERVER_STUB_THREAD_ID: "thread_abc",
    },
  });
  const client = new AppServerClient({
    writeLine: (line) => appServerProcess.writeLine(line),
  });
  const router = new RouterService({
    allowedUserId: project.config.allowedUserId,
    projectsFile: project.config.projectsFile,
    store,
    ensureThreadWorktree: async ({ repoPath, slackThreadTs }) => {
      const worktreePath = buildWorktreePath(repoPath, slackThreadTs);
      mkdirSync(worktreePath, { recursive: true });
      return {
        worktreePath,
        branchName: buildBranchName(slackThreadTs),
      };
    },
    threadStart: async (input) => client.threadStart(input),
    turnStart: async (input) => client.turnStart(input),
  });
  const processExitCodes: number[] = [];

  void appServerProcess.waitForExit().then((code) => {
    if (typeof code === "number") {
      processExitCodes.push(code);
    }
  });

  await startRouterRuntime({
    config: project.config,
    store,
    appServerProcess,
    appServerClient: client,
    slackApp: slack.app,
    routerService: router,
    registerSlackMessageHandler,
  });

  return {
    slack,
    store,
    processExitCodes,
    async waitForRequest(method, waitOptions = {}) {
      const occurrence = waitOptions.occurrence ?? 1;

      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (existsSync(requestLogPath)) {
          const requests = readRequests(requestLogPath);
          const match = requests.filter((request) => request.method === method)[occurrence - 1];
          if (match) {
            return match;
          }
        }

        await delay(10);
      }

      throw new Error(`Timed out waiting for request '${method}'.`);
    },
    async waitForSlackMessage(waitOptions = {}) {
      const occurrence = waitOptions.occurrence ?? 1;

      for (let attempt = 0; attempt < 200; attempt += 1) {
        const message = slack.postedMessages[occurrence - 1];
        if (message) {
          return message;
        }

        await delay(10);
      }

      throw new Error("Timed out waiting for a Slack message.");
    },
    async dispatchTopLevelMessage(input) {
      await slack.dispatchMessage({
        user: input.user,
        channel: input.channel,
        ts: input.ts,
        text: input.text,
      });
    },
    async dispatchAction(actionId, body) {
      await slack.dispatchAction(actionId, body);
    },
    async cleanup() {
      appServerProcess.child.kill();
      await appServerProcess.waitForExit().catch(() => undefined);
      store.close();
      project.cleanup();
      rmSync(requestLogDir, { recursive: true, force: true });
    },
  };
}

function readRequests(requestLogPath: string): LoggedRequest[] {
  return readFileSync(requestLogPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LoggedRequest);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
