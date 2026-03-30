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

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve,
        reject,
      });
    });

    this.options.writeLine(payload);

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
