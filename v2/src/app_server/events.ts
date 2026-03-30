const notificationMethods = [
  "thread/status/changed",
  "turn/item",
  "tool/requestUserInput",
] as const;

type AppServerNotificationMethod = (typeof notificationMethods)[number];

export type AppServerNotification = {
  method: AppServerNotificationMethod;
  params: Record<string, unknown>;
};

export type AppServerResponse =
  | { id: string; result: unknown }
  | { id: string; error: { code?: number; message: string; data?: unknown } };

export type AppServerMessage =
  | { kind: "notification"; notification: AppServerNotification }
  | { kind: "response"; response: AppServerResponse };

export type AppServerNotificationListener = (
  notification: AppServerNotification,
) => void;

export class AppServerEventStream {
  private readonly listeners = new Set<AppServerNotificationListener>();

  subscribe(listener: AppServerNotificationListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(notification: AppServerNotification): void {
    for (const listener of this.listeners) {
      listener(notification);
    }
  }
}

export function parseAppServerLine(line: string): AppServerMessage | null {
  const parsed = parseJson(line);

  if (!isRecord(parsed)) {
    return null;
  }

  const notification = parseNotification(parsed);
  if (notification) {
    return { kind: "notification", notification };
  }

  const response = parseResponse(parsed);
  if (response) {
    return { kind: "response", response };
  }

  return null;
}

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function parseNotification(value: Record<string, unknown>): AppServerNotification | null {
  const { method, params } = value;

  if (!isNotificationMethod(method)) {
    return null;
  }

  if (!isRecord(params)) {
    return null;
  }

  return {
    method,
    params: params as Record<string, unknown>,
  };
}

function parseResponse(value: Record<string, unknown>): AppServerResponse | null {
  if (typeof value.id !== "string") {
    return null;
  }

  if ("error" in value) {
    const error = value.error;
    if (!isRecord(error)) {
      return null;
    }

    const message = error.message;
    if (typeof message !== "string") {
      return null;
    }

    return {
      id: value.id,
      error: {
        code: typeof error.code === "number" ? error.code : undefined,
        message,
        data: error.data,
      },
    };
  }

  return {
    id: value.id,
    result: value.result,
  };
}

function isNotificationMethod(value: unknown): value is AppServerNotificationMethod {
  return (
    typeof value === "string" &&
    notificationMethods.includes(value as AppServerNotificationMethod)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
