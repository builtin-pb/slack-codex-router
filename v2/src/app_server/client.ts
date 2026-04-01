import {
  AppServerEventStream,
  parseAppServerLine,
} from "./events.js";

type AppServerClientOptions = {
  writeLine(line: string): void | Promise<void>;
  createRequestId?(): string;
  requestTimeoutMs?: number;
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

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class AppServerClient {
  readonly events = new AppServerEventStream();

  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly pendingRequestTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private transportFailure: Error | null = null;
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
    this.transportFailure ??= error;
    const pendingRequests = [...this.pendingRequests.values()];
    this.pendingRequests.clear();
    this.clearPendingRequestTimers();

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
    this.clearPendingRequestTimer(message.response.id);

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
    if (this.transportFailure) {
      return Promise.reject(this.transportFailure);
    }

    const id = this.createRequestId();
    const payload = JSON.stringify({ id, method, params });
    let pendingRequest: PendingRequest | undefined;

    const promise = new Promise<unknown>((resolve, reject) => {
      pendingRequest = {
        resolve,
        reject,
      };
      this.pendingRequests.set(id, pendingRequest);
      this.startRequestTimeout(id, pendingRequest);
    });

    try {
      const writeResult = this.options.writeLine(payload);
      if (isPromiseLike(writeResult)) {
        void writeResult.catch((error: unknown) => {
          const transportError = asError(error, "App Server transport write failed");
          this.pendingRequests.delete(id);
          pendingRequest?.reject(transportError);
          this.failPendingRequests(transportError);
        });
      }
    } catch (error) {
      const transportError = asError(error, "App Server transport write failed");
      this.pendingRequests.delete(id);
      pendingRequest?.reject(transportError);
      this.failPendingRequests(transportError);
    }

    return promise as Promise<T>;
  }

  private startRequestTimeout(id: string, pendingRequest: PendingRequest): void {
    const requestTimeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (requestTimeoutMs <= 0) {
      return;
    }

    const timeoutHandle = setTimeout(() => {
      if (!this.pendingRequests.has(id)) {
        this.pendingRequestTimers.delete(id);
        return;
      }

      const error = new Error(`App Server request timed out after ${requestTimeoutMs}ms`);
      this.pendingRequests.delete(id);
      this.pendingRequestTimers.delete(id);
      pendingRequest.reject(error);
      this.failPendingRequests(error);
    }, requestTimeoutMs);
    timeoutHandle.unref?.();
    this.pendingRequestTimers.set(id, timeoutHandle);
  }

  private clearPendingRequestTimer(id: string): void {
    const timeoutHandle = this.pendingRequestTimers.get(id);
    if (!timeoutHandle) {
      return;
    }

    clearTimeout(timeoutHandle);
    this.pendingRequestTimers.delete(id);
  }

  private clearPendingRequestTimers(): void {
    for (const timeoutHandle of this.pendingRequestTimers.values()) {
      clearTimeout(timeoutHandle);
    }

    this.pendingRequestTimers.clear();
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

function isPromiseLike(value: unknown): value is PromiseLike<void> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
