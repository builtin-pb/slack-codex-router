import {
  AppServerEventStream,
  parseAppServerLine,
} from "./events.js";

type AppServerClientOptions = {
  writeLine(line: string): void;
  createRequestId?(): string;
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

type RequestParams = Record<string, unknown>;

const CLIENT_INFO = {
  name: "slack-codex-router",
  version: "0.1.0",
} as const;

export class AppServerClient {
  readonly events = new AppServerEventStream();

  private readonly pendingRequests = new Map<string, PendingRequest>();
  private nextRequestId = 1;

  constructor(private readonly options: AppServerClientOptions) {}

  async initialize(): Promise<void> {
    await this.sendRequest("initialize", { clientInfo: CLIENT_INFO });
  }

  async threadStart(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await this.sendRequest<Record<string, unknown>>("thread/start", input);
    return normalizeThreadStartResult(result);
  }

  async turnStart(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await this.sendRequest<Record<string, unknown>>(
      "turn/start",
      normalizeTurnStartParams(input),
    );
    return normalizeTurnResult(result);
  }

  async turnSteer(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await this.sendRequest<Record<string, unknown>>(
      "turn/steer",
      normalizeTurnSteerParams(input),
    );
    return normalizeTurnResult(result);
  }

  async turnInterrupt(input: Record<string, unknown>): Promise<void> {
    await this.sendRequest("turn/interrupt", input);
  }

  reviewStart(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.sendRequest("review/start", input);
  }

  failPendingRequests(error: Error): void {
    const pendingRequests = [...this.pendingRequests.values()];
    this.pendingRequests.clear();

    for (const pendingRequest of pendingRequests) {
      pendingRequest.reject(error);
    }
  }

  handleLine(line: string): void {
    const message = parseAppServerLine(line);

    if (!message) {
      return;
    }

    if (message.kind === "notification") {
      this.events.emit(message.notification);
      return;
    }

    const pendingRequest = this.pendingRequests.get(message.response.id);
    if (!pendingRequest) {
      return;
    }

    this.pendingRequests.delete(message.response.id);

    if ("error" in message.response) {
      pendingRequest.reject(new Error(message.response.error.message));
      return;
    }

    pendingRequest.resolve(message.response.result);
  }

  private sendRequest<T>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    const id = this.createRequestId();
    const payload = JSON.stringify({ id, method, params });
    let pendingRequest: PendingRequest | undefined;

    const promise = new Promise<unknown>((resolve, reject) => {
      pendingRequest = {
        resolve,
        reject,
      };
      this.pendingRequests.set(id, pendingRequest);
    });

    try {
      this.options.writeLine(payload);
    } catch (error) {
      this.pendingRequests.delete(id);
      pendingRequest?.reject(asError(error, "App Server transport write failed"));
    }

    return promise as Promise<T>;
  }

  private createRequestId(): string {
    if (this.options.createRequestId) {
      return this.options.createRequestId();
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return String(id);
  }
}

export type { AppServerNotification } from "./events.js";

function normalizeThreadStartResult(result: Record<string, unknown>): Record<string, unknown> {
  const threadId = readNestedId(result, "thread");
  if (!threadId) {
    return result;
  }

  return { threadId };
}

function normalizeTurnResult(result: Record<string, unknown>): Record<string, unknown> {
  const turnId = readNestedId(result, "turn");
  if (!turnId) {
    return result;
  }

  return { turnId };
}

function normalizeTurnStartParams(input: RequestParams): RequestParams {
  return {
    ...normalizeTextInputParams(input),
  };
}

function normalizeTurnSteerParams(input: RequestParams): RequestParams {
  const normalized = normalizeTextInputParams(input);
  const turnId = typeof normalized.turnId === "string" ? normalized.turnId : undefined;

  if (turnId && typeof normalized.expectedTurnId !== "string") {
    normalized.expectedTurnId = turnId;
  }

  delete normalized.turnId;
  return normalized;
}

function normalizeTextInputParams(input: RequestParams): RequestParams {
  const normalized: RequestParams = { ...input };
  const prompt = typeof normalized.prompt === "string" ? normalized.prompt : undefined;

  if (prompt && !Array.isArray(normalized.input)) {
    normalized.input = [{ type: "text", text: prompt }];
  }

  delete normalized.prompt;
  return normalized;
}

function readNestedId(
  result: Record<string, unknown>,
  key: "thread" | "turn",
): string | null {
  const value = result[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return typeof (value as { id?: unknown }).id === "string"
    ? (value as { id: string }).id
    : null;
}

function asError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(fallbackMessage);
}
