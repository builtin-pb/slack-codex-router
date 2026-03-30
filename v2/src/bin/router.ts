import { App } from "@slack/bolt";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AppServerClient } from "../app_server/client.js";
import { spawnAppServerProcess } from "../app_server/process.js";
import { loadConfig, repoRootPath } from "../config.js";
import { RouterStore } from "../persistence/store.js";
import { startRouterRuntime } from "../router/runtime.js";
import { RouterService } from "../router/service.js";
import { registerSlackMessageHandler } from "../slack/app.js";

const dotenvPath = process.env.DOTENV_CONFIG_PATH ?? resolve(repoRootPath, ".env");

loadDotenv({ path: dotenvPath });

export async function main(): Promise<void> {
  const config = loadConfig();
  console.log(
    `v2 router bootstrap ready for ${config.allowedUserId} with ${config.projectsFile}`,
  );

  if (!existsSync(config.projectsFile)) {
    return;
  }

  const store = new RouterStore(config.routerStateDb);
  const appServerProcess = spawnAppServerProcess(config.appServerCommand, {
    cwd: repoRootPath,
    env: process.env,
  });
  const appServerClient = new AppServerClient({
    writeLine: (line) => {
      appServerProcess.writeLine(line);
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
        );
      },
    });

    await appServerProcess.waitForExit();
  } finally {
    store.close();
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
