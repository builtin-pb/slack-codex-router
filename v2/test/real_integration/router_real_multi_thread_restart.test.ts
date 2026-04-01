import { describe, expect, it } from "vitest";
import { createRealAppServerHarness } from "../helpers/real_app_server_harness.js";

describe("real multi-thread restart recovery", () => {
  it(
    "keeps two live threads isolated across restart and rebinds each thread only after a fresh reply",
    async () => {
      const harness = await createRealAppServerHarness({
        scenario: "multi-thread-toy-app-build",
        persistentStore: true,
        useRealGitRepo: true,
      });

      try {
        const threadA = {
          channel: "C08TEMPLATE",
          ts: "1710000000.0800",
        };
        const threadB = {
          channel: "C08TEMPLATE",
          ts: "1710000000.0801",
        };

        await harness.dispatchTopLevelMessage({
          user: "U123",
          channel: threadA.channel,
          ts: threadA.ts,
          text: "Build the first toy app",
        });
        await waitForThreadState(harness, threadA.ts, "awaiting_user_input");
        const threadAInitial = harness.store.getThread(threadA.channel, threadA.ts);
        const buttonAInitial = await waitForChoiceButton(harness, threadA.ts, "Approve");

        await harness.dispatchTopLevelMessage({
          user: "U123",
          channel: threadB.channel,
          ts: threadB.ts,
          text: "Build the second toy app",
        });
        await waitForThreadState(harness, threadB.ts, "awaiting_user_input");
        const threadBInitial = harness.store.getThread(threadB.channel, threadB.ts);
        const buttonBInitial = await waitForChoiceButton(harness, threadB.ts, "Approve");

        expect(threadAInitial?.appServerThreadId).toBeTruthy();
        expect(threadBInitial?.appServerThreadId).toBeTruthy();
        expect(threadAInitial?.appServerThreadId).not.toBe(threadBInitial?.appServerThreadId);

        await harness.dispatchAction("restart_router", {
          user: { id: "U123" },
          channel: { id: threadA.channel },
          message: { thread_ts: threadA.ts },
        });

        await harness.bootNextGeneration();

        expect(harness.store.getThread(threadA.channel, threadA.ts)).toMatchObject({
          state: "interrupted",
          appServerSessionStale: true,
          activeTurnId: null,
        });
        expect(harness.store.getThread(threadB.channel, threadB.ts)).toMatchObject({
          state: "interrupted",
          appServerSessionStale: true,
          activeTurnId: null,
        });

        await harness.dispatchAction(buttonAInitial.action_id, {
          action: buttonAInitial,
          user: { id: "U123" },
          channel: { id: threadA.channel },
          message: { thread_ts: threadA.ts },
        });
        expect(harness.latestActionResponse()).toMatchObject({
          text: expect.stringContaining("needs a new message"),
        });

        await harness.dispatchAction(buttonBInitial.action_id, {
          action: buttonBInitial,
          user: { id: "U123" },
          channel: { id: threadB.channel },
          message: { thread_ts: threadB.ts },
        });
        expect(harness.latestActionResponse()).toMatchObject({
          text: expect.stringContaining("needs a new message"),
        });

        await harness.dispatchThreadReply({
          user: "U123",
          channel: threadA.channel,
          ts: "1710000000.0802",
          thread_ts: threadA.ts,
          text: "continue first thread",
        });

        await waitForRequest(harness, "thread/start", 3);
        await waitForRequest(harness, "turn/start", 3);
        await waitForThreadState(harness, threadA.ts, "awaiting_user_input");
        const threadARebound = harness.store.getThread(threadA.channel, threadA.ts);
        const buttonARebound = await waitForChoiceButton(harness, threadA.ts, "Approve");

        expect(threadARebound?.appServerThreadId).toBeTruthy();
        expect(threadARebound?.appServerThreadId).not.toBe(threadAInitial?.appServerThreadId);
        expect(threadARebound).toMatchObject({
          appServerSessionStale: false,
          state: "awaiting_user_input",
        });
        expect(buttonARebound.value).not.toBe(buttonAInitial.value);
        expect(harness.store.getThread(threadB.channel, threadB.ts)).toMatchObject({
          state: "interrupted",
          appServerSessionStale: true,
        });

        await harness.dispatchThreadReply({
          user: "U123",
          channel: threadB.channel,
          ts: "1710000000.0803",
          thread_ts: threadB.ts,
          text: "continue second thread",
        });

        await waitForRequest(harness, "thread/start", 4);
        await waitForRequest(harness, "turn/start", 4);
        await waitForThreadState(harness, threadB.ts, "awaiting_user_input");
        const threadBRebound = harness.store.getThread(threadB.channel, threadB.ts);
        const buttonBRebound = await waitForChoiceButton(harness, threadB.ts, "Approve");

        expect(threadBRebound?.appServerThreadId).toBeTruthy();
        expect(threadBRebound?.appServerThreadId).not.toBe(threadBInitial?.appServerThreadId);
        expect(threadBRebound?.appServerThreadId).not.toBe(threadARebound?.appServerThreadId);
        expect(threadBRebound).toMatchObject({
          appServerSessionStale: false,
          state: "awaiting_user_input",
        });
        expect(buttonBRebound.value).not.toBe(buttonBInitial.value);

        await harness.dispatchAction(buttonARebound.action_id, {
          action: buttonARebound,
          user: { id: "U123" },
          channel: { id: threadA.channel },
          message: { thread_ts: threadA.ts },
        });
        await waitForThreadState(harness, threadA.ts, "idle");

        expect(harness.store.getThread(threadA.channel, threadA.ts)).toMatchObject({
          state: "idle",
          appServerSessionStale: false,
        });
        expect(harness.store.getThread(threadB.channel, threadB.ts)).toMatchObject({
          state: "awaiting_user_input",
          appServerSessionStale: false,
        });

        await harness.dispatchAction(buttonBRebound.action_id, {
          action: buttonBRebound,
          user: { id: "U123" },
          channel: { id: threadB.channel },
          message: { thread_ts: threadB.ts },
        });
        await waitForThreadState(harness, threadB.ts, "idle");

        expect(harness.store.getThread(threadB.channel, threadB.ts)).toMatchObject({
          state: "idle",
          appServerSessionStale: false,
        });
        expect(harness.readArtifacts()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: "file-write",
              path: "src/app.txt",
              cwd: threadAInitial?.worktreePath,
            }),
            expect.objectContaining({
              kind: "file-write",
              path: "src/app.txt",
              cwd: threadBInitial?.worktreePath,
            }),
          ]),
        );
      } finally {
        await harness.cleanup();
      }
    },
    20000,
  );
});

async function waitForThreadState(
  harness: Awaited<ReturnType<typeof createRealAppServerHarness>>,
  threadTs: string,
  expectedState: "awaiting_user_input" | "idle" | "interrupted",
): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (harness.store.getThread("C08TEMPLATE", threadTs)?.state === expectedState) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for thread state ${expectedState}.`);
}

async function waitForChoiceButton(
  harness: Awaited<ReturnType<typeof createRealAppServerHarness>>,
  threadTs: string,
  choice: string,
): Promise<{ action_id: string; value: string }> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const button = findChoiceButton(harness, threadTs, choice);
    if (button) {
      return button;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for a choice button for ${choice}.`);
}


function findChoiceButton(
  harness: Awaited<ReturnType<typeof createRealAppServerHarness>>,
  threadTs: string,
  choice: string,
): { action_id: string; value: string } | null {
  for (const message of [...harness.slack.postedMessages].reverse()) {
    if (message.thread_ts !== threadTs) {
      continue;
    }

    const blocks = Array.isArray(message.blocks) ? message.blocks : [];
    for (const block of blocks) {
      if (!block || typeof block !== "object" || Array.isArray(block)) {
        continue;
      }

      if ((block as { type?: unknown }).type !== "actions") {
        continue;
      }

      const elements = Array.isArray((block as { elements?: unknown }).elements)
        ? (block as { elements: unknown[] }).elements
        : [];

      for (const element of elements) {
        if (!element || typeof element !== "object" || Array.isArray(element)) {
          continue;
        }

        const actionId = (element as { action_id?: unknown }).action_id;
        const value = (element as { value?: unknown }).value;
        const label = (element as { text?: { text?: unknown } }).text?.text;
        if (
          typeof actionId === "string" &&
          actionId.startsWith("codex_choice:") &&
          typeof value === "string" &&
          label === choice
        ) {
          return { action_id: actionId, value };
        }
      }
    }
  }

  return null;
}

async function waitForRequest(
  harness: Awaited<ReturnType<typeof createRealAppServerHarness>>,
  method: string,
  occurrence: number,
): Promise<Record<string, unknown>> {
  return harness.waitForRequest(method, { occurrence });
}
