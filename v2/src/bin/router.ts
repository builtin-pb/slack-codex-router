import { App } from "@slack/bolt";
import { execFile } from "node:child_process";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { AppServerClient } from "../app_server/client.js";
import { spawnAppServerProcess } from "../app_server/process.js";
import { loadConfig, repoRootPath } from "../config.js";
import { mergeBranchToTarget } from "../git/merge_to_main.js";
import { getRepositoryStatus } from "../git/repository_status.js";
import { RouterStore } from "../persistence/store.js";
import { requestRouterRestart } from "../runtime/restart.js";
import { startRouterRuntime } from "../router/runtime.js";
import { RouterService } from "../router/service.js";
import { registerSlackMessageHandler } from "../slack/app.js";
import { WorktreeManager } from "../worktree/manager.js";

const dotenvPath = process.env.DOTENV_CONFIG_PATH ?? resolve(repoRootPath, ".env");
const execFileAsync = promisify(execFile);

loadDotenv({ path: dotenvPath });

export async function main(): Promise<void> {
  const config = loadConfig();
  console.log(
    `v2 router bootstrap ready for ${config.allowedUserId} with ${config.projectsFile}`,
  );

  if (!existsSync(config.projectsFile)) {
    throw new Error(`Router projects file is missing: ${config.projectsFile}`);
  }

  const store = new RouterStore(config.routerStateDb);
  let storeClosed = false;
  const closeStore = (): void => {
    if (storeClosed) {
      return;
    }

    store.close();
    storeClosed = true;
  };
  const appServerProcess = spawnAppServerProcess(config.appServerCommand, {
    cwd: repoRootPath,
    env: process.env,
  });
  const appServerClient = new AppServerClient({
    writeLine: (line) => {
      appServerProcess.writeLine(line);
    },
  });
  const worktreeManager = new WorktreeManager({
    pathExists: existsSync,
    run: async ({ args, cwd }) => {
      await execFileAsync("git", args, { cwd });
    },
  });
  const slackApp = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true,
  });
  const routerService = new RouterService({
    allowedUserId: config.allowedUserId,
    projectsFile: config.projectsFile,
    store,
    threadStart: async (input) =>
      appServerClient.threadStart(input) as Promise<{ threadId: string }>,
    turnStart: async (input) => appServerClient.turnStart(input),
    ensureThreadWorktree: async (input) => worktreeManager.ensureThreadWorktree(input),
    turnInterrupt: async (input) => appServerClient.turnInterrupt(input),
    reviewStart: async (input) => appServerClient.reviewStart(input),
    requestRestart: async (input) =>
      requestRouterRestart({
        store,
        slackChannelId: input.slackChannelId,
        slackThreadTs: input.slackThreadTs,
      }),
    getRepositoryStatus: async (input) =>
      getRepositoryStatus({
        repoPath: input.repoPath,
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
        run: async ({ args, cwd }) => {
          const result = await execFileAsync("git", args, { cwd });
          return { stdout: result.stdout };
        },
      }),
    executeMergeToMain: async (input) =>
      mergeBranchToTarget({
        repoPath: input.repoPath,
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
        restoreOriginalHead: false,
        run: async ({ args, cwd }) => {
          const result = await execFileAsync("git", args, { cwd });
          return { stdout: result.stdout };
        },
      }),
  });

  try {
    await startRouterRuntime({
      config,
      store,
      appServerProcess,
      appServerClient,
      slackApp,
      routerService,
      registerSlackMessageHandler: (app, router) => {
        registerSlackMessageHandler(
          app as Parameters<typeof registerSlackMessageHandler>[0],
          router as Parameters<typeof registerSlackMessageHandler>[1],
          {
            requestProcessExit(exitCode) {
              closeStore();
              process.exitCode = exitCode;
              setTimeout(() => {
                process.exit(exitCode);
              }, 0);
            },
          },
        );
      },
    });

    await appServerProcess.waitForExit();
  } finally {
    closeStore();
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
