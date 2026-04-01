import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import {
  AppServerClient,
  type AppServerNotification,
} from "../src/app_server/client.js";
import { spawnAppServerProcess } from "../src/app_server/process.js";

function getPendingRequestCount(client: AppServerClient): number {
  return (
    (client as unknown as { pendingRequests: Map<string, unknown> }).pendingRequests
      .size
  );
}

describe("AppServerClient", () => {
  it("sends requests, correlates responses, and emits parsed notifications", async () => {
    const sent: string[] = [];
    const notifications: AppServerNotification[] = [];
    let nextId = 1;

    const client = new AppServerClient({
      writeLine: (line) => {
        sent.push(line);
      },
      createRequestId: () => String(nextId++),
    });

    const unsubscribe = client.events.subscribe((notification) => {
      notifications.push(notification);
    });

    const initialize = client.initialize();
    expect(sent[0]).toContain('"id":"1"');
    expect(sent[0]).toContain('"method":"initialize"');
    expect(sent[0]).toContain('"clientInfo"');
    expect(sent[0]).toContain('"name":"slack-codex-router"');

    client.handleLine('{"id":"1","result":{}}');
    await expect(initialize).resolves.toBeUndefined();

    const threadStart = client.threadStart({ prompt: "hello" });
    expect(sent[1]).toContain('"id":"2"');
    expect(sent[1]).toContain('"method":"thread/start"');
    expect(sent[1]).toContain('"prompt":"hello"');

    client.handleLine(
      '{"method":"thread/status/changed","params":{"threadId":"thread_123","state":"running"}}',
    );
    client.handleLine(
      '{"id":"2","result":{"thread":{"id":"thread_123","cwd":"/repo"}}}',
    );

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
      writeLine: (line) => {
        sent.push(line);
      },
      createRequestId: () => String(nextId++),
    });

    const turnStart = client.turnStart({ threadId: "thread_123", prompt: "go" });
    const turnSteer = client.turnSteer({ turnId: "turn_123", prompt: "adjust" });
    const turnInterrupt = client.turnInterrupt({
      threadId: "thread_123",
      turnId: "turn_123",
    });
    const reviewStart = (
      client as AppServerClient & {
        reviewStart(input: Record<string, unknown>): Promise<Record<string, unknown>>;
      }
    ).reviewStart({
      threadId: "thread_123",
      target: { type: "uncommittedChanges" },
    });

    expect(sent[0]).toContain('"method":"turn/start"');
    expect(sent[1]).toContain('"method":"turn/steer"');
    expect(sent[2]).toContain('"method":"turn/interrupt"');
    expect(sent[0]).toContain('"input"');
    expect(sent[0]).toContain('"type":"text"');
    expect(sent[0]).toContain('"text":"go"');
    expect(sent[1]).toContain('"expectedTurnId":"turn_123"');
    expect(sent[1]).toContain('"input"');
    expect(sent[1]).toContain('"text":"adjust"');
    expect(sent[2]).toContain('"threadId":"thread_123"');
    expect(sent[2]).toContain('"turnId":"turn_123"');
    expect(sent[3]).toContain('"method":"review/start"');
    expect(sent[3]).toContain('"type":"uncommittedChanges"');

    client.handleLine('{"id":"1","result":{"turn":{"id":"turn_123"}}}');
    client.handleLine(
      '{"id":"2","error":{"code":400,"message":"cannot steer finished turn"}}',
    );
    client.handleLine('{"id":"3","result":{}}');
    client.handleLine('{"id":"4","result":{"reviewId":"review_123"}}');

    await expect(turnStart).resolves.toEqual({ turnId: "turn_123" });
    await expect(turnSteer).rejects.toThrow("cannot steer finished turn");
    await expect(turnInterrupt).resolves.toBeUndefined();
    await expect(reviewStart).resolves.toEqual({ reviewId: "review_123" });
  });

  it("matches out-of-order responses to the original request ids", async () => {
    const sent: string[] = [];
    let nextId = 1;
    const client = new AppServerClient({
      writeLine: (line) => {
        sent.push(line);
      },
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

  it("ignores duplicate responses after the request has settled", async () => {
    const sent: string[] = [];
    let nextId = 1;
    const client = new AppServerClient({
      writeLine: (line) => {
        sent.push(line);
      },
      createRequestId: () => String(nextId++),
    });

    const request = client.threadStart({ prompt: "hello" });

    client.handleLine('{"id":"1","result":{"threadId":"thread_123"}}');

    await expect(request).resolves.toEqual({ threadId: "thread_123" });
    expect(getPendingRequestCount(client)).toBe(0);

    client.handleLine('{"id":"1","error":{"code":500,"message":"duplicate"}}');
    expect(getPendingRequestCount(client)).toBe(0);
    expect(sent).toHaveLength(1);
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

  it("parses current item lifecycle notifications and preserves legacy turn/item compatibility", () => {
    const notifications: AppServerNotification[] = [];
    const client = new AppServerClient({
      writeLine: () => {},
    });

    client.events.subscribe((notification) => {
      notifications.push(notification);
    });

    client.handleLine(
      '{"method":"item/completed","params":{"threadId":"thread_123","item":{"type":"message","role":"assistant","text":"Working on it."}}}',
    );
    client.handleLine(
      '{"method":"item/agentMessage/delta","params":{"threadId":"thread_123","delta":"Working"}}',
    );
    client.handleLine(
      '{"method":"turn/item","params":{"threadId":"thread_123","item":{"type":"message","role":"assistant","text":"Legacy item."}}}',
    );

    expect(notifications).toEqual([
      {
        method: "item/completed",
        params: {
          threadId: "thread_123",
          item: { type: "message", role: "assistant", text: "Working on it." },
        },
      },
      {
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread_123",
          delta: "Working",
        },
      },
      {
        method: "turn/item",
        params: {
          threadId: "thread_123",
          item: { type: "message", role: "assistant", text: "Legacy item." },
        },
      },
    ]);
  });

  it("ignores invalid JSON and unmatched response ids until the matching response arrives", async () => {
    const sent: string[] = [];
    let nextId = 1;
    const client = new AppServerClient({
      writeLine: (line) => {
        sent.push(line);
      },
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

  it("rejects and clears the pending request when transport writes fail synchronously", async () => {
    const client = new AppServerClient({
      writeLine: () => {
        throw new Error("transport write failed");
      },
      createRequestId: () => "1",
    });

    await expect(client.threadStart({ prompt: "hello" })).rejects.toThrow(
      "transport write failed",
    );
    expect(getPendingRequestCount(client)).toBe(0);
  });

  it("fails already-pending requests and latches the transport when a later write throws", async () => {
    const sent: string[] = [];
    let writes = 0;
    let nextId = 1;
    const client = new AppServerClient({
      writeLine: (line) => {
        writes += 1;
        if (writes === 2) {
          throw new Error("transport write failed");
        }

        sent.push(line);
      },
      createRequestId: () => String(nextId++),
    });

    const first = client.threadStart({ prompt: "first" });
    const second = client.turnStart({ threadId: "thread_123", prompt: "second" });

    await expect(second).rejects.toThrow("transport write failed");
    await expect(first).rejects.toThrow("transport write failed");
    await expect(client.turnInterrupt({ threadId: "thread_123", turnId: "turn_123" })).rejects.toThrow(
      "transport write failed",
    );

    expect(sent).toHaveLength(1);
    expect(getPendingRequestCount(client)).toBe(0);
  });

  it("rejects all pending requests when the transport closes", async () => {
    const sent: string[] = [];
    let nextId = 1;
    const client = new AppServerClient({
      writeLine: (line) => {
        sent.push(line);
      },
      createRequestId: () => String(nextId++),
    });

    const first = client.threadStart({ prompt: "first" });
    const second = client.turnStart({ threadId: "thread_123", prompt: "second" });

    client.failPendingRequests(new Error("transport closed"));

    await expect(first).rejects.toThrow("transport closed");
    await expect(second).rejects.toThrow("transport closed");
    expect(getPendingRequestCount(client)).toBe(0);
  });

  it("rejects new requests after transport failure instead of writing to a dead transport", async () => {
    const sent: string[] = [];
    let nextId = 1;
    const client = new AppServerClient({
      writeLine: (line) => {
        sent.push(line);
      },
      createRequestId: () => String(nextId++),
    });

    const first = client.threadStart({ prompt: "first" });

    client.failPendingRequests(new Error("transport closed"));
    await expect(first).rejects.toThrow("transport closed");

    client.handleLine('{"id":"1","result":{"threadId":"thread_late"}}');

    const nextRequest = client.turnStart({ threadId: "thread_123", prompt: "second" });
    const outcome = await Promise.race([
      nextRequest.then(
        () => "resolved",
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      ),
      delay(20, "timed out"),
    ]);

    expect(outcome).toBe("transport closed");
    expect(sent).toHaveLength(1);
    expect(getPendingRequestCount(client)).toBe(0);
  });

  it("does not leave requests hanging when stdin is closed but the child stays alive", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "app-server-client-half-open-"));

    try {
      const scriptPath = join(tempDir, "stdin-closed.mjs");
      writeFileSync(
        scriptPath,
        [
          'import { closeSync } from "node:fs";',
          "closeSync(0);",
          'process.stdout.write("ready\\n");',
          "setTimeout(() => process.exit(0), 200);",
          "",
        ].join("\n"),
        "utf8",
      );

      const appServer = spawnAppServerProcess([process.execPath, scriptPath], {
        cwd: tempDir,
      });
      const ready = new Promise<void>((resolve) => {
        const unsubscribe = appServer.onLine((line) => {
          if (line !== "ready") {
            return;
          }

          unsubscribe();
          resolve();
        });
      });
      const client = new AppServerClient({
        writeLine: (line) => appServer.writeLine(line),
        createRequestId: () => "1",
        requestTimeoutMs: 50,
      });

      try {
        await ready;

        const initializeOutcome = client.initialize().then(
          () => "resolved",
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        );
        const waitState = await Promise.race([
          appServer.waitForExit().then(() => "exited"),
          delay(50, "alive"),
        ]);
        const outcome = await Promise.race([
          initializeOutcome,
          delay(50, "timed out"),
        ]);

        expect(waitState).toBe("alive");
        expect(outcome).toBe("write EPIPE");
      } finally {
        appServer.child.kill();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects initialize when the transport write promise rejects asynchronously", async () => {
    const client = new AppServerClient({
      writeLine: async () => {
        await delay(10);
        throw new Error("App Server stdin write timed out");
      },
      createRequestId: () => "1",
      requestTimeoutMs: 500,
    });

    const outcome = await Promise.race([
      client.initialize().then(
        () => "resolved",
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      ),
      delay(200, "timed out"),
    ]);

    expect(outcome).toBe("App Server stdin write timed out");
    expect(getPendingRequestCount(client)).toBe(0);
    await expect(client.threadStart({ prompt: "hello" })).rejects.toThrow(
      "App Server stdin write timed out",
    );
  });
});
