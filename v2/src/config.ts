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
    projectsFile: optionalAnyEnv(env, [
      "PROJECTS_FILE",
      "SCR_PROJECTS_FILE",
    ], "config/projects.yaml"),
    routerStateDb: optionalAnyEnv(env, [
      "ROUTER_STATE_DB",
      "SCR_STATE_DB",
    ], "logs/router-v2/state.sqlite3"),
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

function optionalAnyEnv(
  env: NodeJS.ProcessEnv,
  keys: string[],
  defaultValue: string,
): string {
  for (const key of keys) {
    const value = env[key];
    if (value && value.trim().length > 0) {
      return value;
    }
  }

  return defaultValue;
}

function parseCommand(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of command.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (quote === "'") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = null;
      } else if (char === "\\") {
        escaping = true;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    throw new Error("Unterminated escape in CODEX_APP_SERVER_COMMAND");
  }

  if (quote !== null) {
    throw new Error("Unterminated quote in CODEX_APP_SERVER_COMMAND");
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}
