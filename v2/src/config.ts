export type RouterConfig = {
  slackBotToken: string;
  slackAppToken: string;
  allowedUserId: string;
  projectsFile: string;
  routerStateDb: string;
  appServerCommand: string[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RouterConfig {
  return {
    slackBotToken: requireEnv(env, "SLACK_BOT_TOKEN"),
    slackAppToken: requireEnv(env, "SLACK_APP_TOKEN"),
    allowedUserId: requireAnyEnv(env, [
      "SLACK_ALLOWED_USER_ID",
      "ALLOWED_SLACK_USER_ID",
    ]),
    projectsFile: env.PROJECTS_FILE ?? "config/projects.yaml",
    routerStateDb: env.ROUTER_STATE_DB ?? "logs/router-v2/state.sqlite3",
    appServerCommand: parseCommand(
      env.CODEX_APP_SERVER_COMMAND ?? "codex app-server",
    ),
  };
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value && value.trim().length > 0) {
    return value;
  }

  throw new Error(`Missing required environment variable: ${key}`);
}

function requireAnyEnv(env: NodeJS.ProcessEnv, keys: string[]): string {
  for (const key of keys) {
    const value = env[key];
    if (value && value.trim().length > 0) {
      return value;
    }
  }

  throw new Error(
    `Missing required environment variable: one of ${keys.join(", ")}`,
  );
}

function parseCommand(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
}
