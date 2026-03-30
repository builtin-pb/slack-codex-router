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

export class AppServerClient {
  readonly events = new AppServerEventStream();

  private readonly pendingRequests = new Map<string, PendingRequest>();
  private nextRequestId = 1;

  constructor(private readonly options: AppServerClientOptions) {}

  async initialize(): Promise<void> {
    await this.sendRequest("initialize", {});
  }

  threadStart(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.sendRequest("thread/start", input);
  }

  turnStart(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.sendRequest("turn/start", input);
  }

  turnSteer(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.sendRequest("turn/steer", input);
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

function asError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(fallbackMessage);
}
