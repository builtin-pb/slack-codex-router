import { describe, expect, it } from "vitest";
import {
  AppServerClient,
  type AppServerNotification,
} from "../src/app_server/client.js";

describe("AppServerClient", () => {
  it("sends requests, correlates responses, and emits parsed notifications", async () => {
    const sent: string[] = [];
    const notifications: AppServerNotification[] = [];
    let nextId = 1;

    const client = new AppServerClient({
      writeLine: (line) => sent.push(line),
      createRequestId: () => String(nextId++),
    });

    const unsubscribe = client.events.subscribe((notification) => {
      notifications.push(notification);
    });

    const initialize = client.initialize();
    expect(sent[0]).toContain('"id":"1"');
    expect(sent[0]).toContain('"method":"initialize"');

    client.handleLine('{"id":"1","result":{}}');
    await expect(initialize).resolves.toBeUndefined();

    const threadStart = client.threadStart({ prompt: "hello" });
    expect(sent[1]).toContain('"id":"2"');
    expect(sent[1]).toContain('"method":"thread/start"');
    expect(sent[1]).toContain('"prompt":"hello"');

    client.handleLine(
      '{"method":"thread/status/changed","params":{"threadId":"thread_123","state":"running"}}',
    );
    client.handleLine('{"id":"2","result":{"threadId":"thread_123"}}');

    await expect(threadStart).resolves.toEqual({ threadId: "thread_123" });
    expect(notifications).toEqual([
      {
        method: "thread/status/changed",
        params: { threadId: "thread_123", state: "running" },
      },
    ]);

    unsubscribe();
  });

  it("supports the turn lifecycle methods and server error responses", async () => {
    const sent: string[] = [];
    let nextId = 1;
    const client = new AppServerClient({
      writeLine: (line) => sent.push(line),
      createRequestId: () => String(nextId++),
    });

    const turnStart = client.turnStart({ threadId: "thread_123", prompt: "go" });
    const turnSteer = client.turnSteer({ turnId: "turn_123", prompt: "adjust" });
    const turnInterrupt = client.turnInterrupt({ turnId: "turn_123" });

    expect(sent[0]).toContain('"method":"turn/start"');
    expect(sent[1]).toContain('"method":"turn/steer"');
    expect(sent[2]).toContain('"method":"turn/interrupt"');

    client.handleLine('{"id":"1","result":{"turnId":"turn_123"}}');
    client.handleLine(
      '{"id":"2","error":{"code":400,"message":"cannot steer finished turn"}}',
    );
    client.handleLine('{"id":"3","result":{}}');

    await expect(turnStart).resolves.toEqual({ turnId: "turn_123" });
    await expect(turnSteer).rejects.toThrow("cannot steer finished turn");
    await expect(turnInterrupt).resolves.toBeUndefined();
  });

  it("matches out-of-order responses to the original request ids", async () => {
    const sent: string[] = [];
    let nextId = 1;
    const client = new AppServerClient({
      writeLine: (line) => sent.push(line),
      createRequestId: () => String(nextId++),
    });

    const first = client.threadStart({ prompt: "first" });
    const second = client.turnSteer({ turnId: "turn_123", prompt: "second" });

    expect(sent[0]).toContain('"id":"1"');
    expect(sent[1]).toContain('"id":"2"');

    client.handleLine(
      '{"id":"2","error":{"code":409,"message":"second request failed"}}',
    );
    client.handleLine('{"id":"1","result":{"threadId":"thread_first"}}');

    await expect(second).rejects.toThrow("second request failed");
    await expect(first).resolves.toEqual({ threadId: "thread_first" });
  });

  it("stops delivering notifications after unsubscribe", () => {
    const notifications: AppServerNotification[] = [];
    const client = new AppServerClient({
      writeLine: () => {},
    });

    const unsubscribe = client.events.subscribe((notification) => {
      notifications.push(notification);
    });

    client.handleLine(
      '{"method":"thread/status/changed","params":{"threadId":"thread_123","state":"running"}}',
    );
    unsubscribe();
    client.handleLine(
      '{"method":"turn/item","params":{"turnId":"turn_123","itemId":"item_1"}}',
    );

    expect(notifications).toEqual([
      {
        method: "thread/status/changed",
        params: { threadId: "thread_123", state: "running" },
      },
    ]);
  });

  it("ignores invalid JSON and unmatched response ids until the matching response arrives", async () => {
    const sent: string[] = [];
    let nextId = 1;
    const client = new AppServerClient({
      writeLine: (line) => sent.push(line),
      createRequestId: () => String(nextId++),
    });

    const request = client.threadStart({ prompt: "hello" });
    let settled = false;
    request.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    client.handleLine("not json");
    client.handleLine(
      '{"method":"thread/status/changed","params":"not-an-object"}',
    );
    client.handleLine('{"id":"999","result":{"threadId":"wrong"}}');

    await Promise.resolve();

    expect(settled).toBe(false);

    client.handleLine('{"id":"1","result":{"threadId":"thread_123"}}');

    await expect(request).resolves.toEqual({ threadId: "thread_123" });
  });
});
