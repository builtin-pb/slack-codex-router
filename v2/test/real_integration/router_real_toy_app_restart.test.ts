import { describe, expect, it } from "vitest";
import { RESTART_EXIT_CODE } from "../../src/runtime/restart.js";
import { createRealAppServerHarness } from "../helpers/real_app_server_harness.js";

describe("real toy-app restart recovery", () => {
  it(
    "rejects stale controls after restart and completes the toy-app flow after a fresh rebind",
    async () => {
      const harness = await createRealAppServerHarness({
        scenario: "toy-app-build",
        persistentStore: true,
        useRealGitRepo: true,
      });

      try {
        await harness.dispatchTopLevelMessage({
          user: "U123",
          channel: "C08TEMPLATE",
          ts: "1710000000.0700",
          text: "Build a tiny toy app",
        });
        await waitForThreadState(harness, "1710000000.0700", "awaiting_user_input");
        const staleButton = findRenderedChoiceButton(harness, "Approve");

        await harness.dispatchAction("restart_router", {
          user: { id: "U123" },
          channel: { id: "C08TEMPLATE" },
          message: { thread_ts: "1710000000.0700" },
        });

        expect(harness.processExitCodes).toContain(RESTART_EXIT_CODE);
        await harness.bootNextGeneration();

        expect(harness.slack.postedMessages.at(-1)).toMatchObject({
          thread_ts: "1710000000.0700",
          text: expect.stringContaining("Router restarted."),
        });

        await harness.dispatchAction(staleButton.action_id, {
          action: {
            action_id: staleButton.action_id,
            value: staleButton.value,
          },
          user: { id: "U123" },
          channel: { id: "C08TEMPLATE" },
          message: { thread_ts: "1710000000.0700" },
        });

        expect(harness.latestActionResponse()).toMatchObject({
          text: "This Slack thread needs a new message to refresh the Codex session.",
        });

        await harness.dispatchThreadReply({
          user: "U123",
          channel: "C08TEMPLATE",
          ts: "1710000000.0701",
          thread_ts: "1710000000.0700",
          text: "continue",
        });

        expect(await harness.waitForRequest("thread/start", { occurrence: 2 })).toBeTruthy();
        expect(await harness.waitForRequest("turn/start", { occurrence: 2 })).toMatchObject({
          params: {
            input: [{ type: "text", text: "continue" }],
          },
        });
        await waitForThreadState(harness, "1710000000.0700", "awaiting_user_input");

        const freshButton = findRenderedChoiceButton(harness, "Approve");
        await harness.dispatchAction(freshButton.action_id, {
          action: {
            action_id: freshButton.action_id,
            value: freshButton.value,
          },
          user: { id: "U123" },
          channel: { id: "C08TEMPLATE" },
          message: { thread_ts: "1710000000.0700" },
        });
        expect(await harness.waitForRequest("turn/start", { occurrence: 3 })).toMatchObject({
          params: {
            input: [{ type: "text", text: "Approve" }],
          },
        });

        await waitForToyAppCompletion(harness, "1710000000.0700");

        expect(harness.readArtifacts()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: "file-write", path: "src/app.txt" }),
          ]),
        );
        expect(harness.store.getThread("C08TEMPLATE", "1710000000.0700")).toMatchObject({
          state: "idle",
          appServerSessionStale: false,
        });
      } finally {
        await harness.cleanup();
      }
    },
    15000,
  );

  it(
    "collapses a burst of stale-session thread replies into one rebind after restart",
    async () => {
      const harness = await createRealAppServerHarness({
        scenario: "toy-app-build",
        persistentStore: true,
        useRealGitRepo: true,
      });

      try {
        await harness.dispatchTopLevelMessage({
          user: "U123",
          channel: "C08TEMPLATE",
          ts: "1710000000.0710",
          text: "Build a tiny toy app",
        });
        await waitForThreadState(harness, "1710000000.0710", "awaiting_user_input");

        await harness.dispatchAction("restart_router", {
          user: { id: "U123" },
          channel: { id: "C08TEMPLATE" },
          message: { thread_ts: "1710000000.0710" },
        });

        expect(harness.processExitCodes).toContain(RESTART_EXIT_CODE);
        await harness.bootNextGeneration();

        const replyDispatches = Array.from({ length: 5 }, (_, index) =>
          harness.dispatchThreadReply({
            user: "U123",
            channel: "C08TEMPLATE",
            ts: `1710000000.071${index + 1}`,
            thread_ts: "1710000000.0710",
            text: "continue",
          }),
        );

        await Promise.all(replyDispatches);
        await waitForThreadState(harness, "1710000000.0710", "awaiting_user_input");

        const requests = harness.readRequests();
        expect(requests.filter((request) => request.method === "thread/start")).toHaveLength(2);
        expect(requests.filter((request) => request.method === "turn/start")).toHaveLength(2);

        const replyTexts = harness.slack.saidMessages.map((message) =>
          typeof message.text === "string" ? message.text : "",
        );
        expect(
          replyTexts.filter((text) => text === "Continuing Codex task for project `template`."),
        ).toHaveLength(1);
        expect(
          replyTexts.filter((text) => text === "This Slack thread already has a running Codex turn."),
        ).toHaveLength(4);

        expect(harness.store.getThread("C08TEMPLATE", "1710000000.0710")).toMatchObject({
          state: "awaiting_user_input",
          appServerSessionStale: false,
        });
      } finally {
        await harness.cleanup();
      }
      },
    15000,
  );

  it(
    "collapses mixed stale choice replays and thread replies on a recovered thread after restart",
    async () => {
      const harness = await createRealAppServerHarness({
        scenario: "toy-app-build",
        persistentStore: true,
        useRealGitRepo: true,
      });

      try {
        await harness.dispatchTopLevelMessage({
          user: "U123",
          channel: "C08TEMPLATE",
          ts: "1710000000.0720",
          text: "Build a tiny toy app",
        });
        await waitForThreadState(harness, "1710000000.0720", "awaiting_user_input");

        const staleButton = findRenderedChoiceButton(harness, "Approve");

        await harness.dispatchAction("restart_router", {
          user: { id: "U123" },
          channel: { id: "C08TEMPLATE" },
          message: { thread_ts: "1710000000.0720" },
        });

        expect(harness.processExitCodes).toContain(RESTART_EXIT_CODE);
        await harness.bootNextGeneration();
        const actionResponseBaseline = harness.actionResponses.length;

        const staleChoiceDispatches = Array.from({ length: 5 }, () =>
          harness.dispatchAction(staleButton.action_id, {
            action: {
              action_id: staleButton.action_id,
              value: staleButton.value,
            },
            user: { id: "U123" },
            channel: { id: "C08TEMPLATE" },
            message: { thread_ts: "1710000000.0720" },
          }),
        );
        const threadReplyDispatches = Array.from({ length: 5 }, (_, index) =>
          harness.dispatchThreadReply({
            user: "U123",
            channel: "C08TEMPLATE",
            ts: `1710000000.072${index + 1}`,
            thread_ts: "1710000000.0720",
            text: "continue",
          }),
        );

        await Promise.all([...staleChoiceDispatches, ...threadReplyDispatches]);
        await waitForThreadState(harness, "1710000000.0720", "awaiting_user_input");

        const requests = harness.readRequests();
        expect(requests.filter((request) => request.method === "thread/start")).toHaveLength(2);
        expect(requests.filter((request) => request.method === "turn/start")).toHaveLength(2);

        const replayedActionResponses = harness.actionResponses.slice(actionResponseBaseline);
        expect(replayedActionResponses).toHaveLength(5);
        expect(
          replayedActionResponses.every((response) =>
            typeof response.text === "string" &&
            response.text.includes("new message to refresh the Codex session"),
          ),
        ).toBe(true);

        const replyTexts = harness.slack.saidMessages.map((message) =>
          typeof message.text === "string" ? message.text : "",
        );
        expect(
          replyTexts.filter((text) => text === "Continuing Codex task for project `template`."),
        ).toHaveLength(1);
        expect(
          replyTexts.filter((text) => text === "This Slack thread already has a running Codex turn."),
        ).toHaveLength(4);

        expect(harness.store.getThread("C08TEMPLATE", "1710000000.0720")).toMatchObject({
          state: "awaiting_user_input",
          appServerSessionStale: false,
        });
      } finally {
        await harness.cleanup();
      }
    },
    15000,
  );

  it(
    "survives a second restart while a stale-thread rebind is still waiting on turn/start",
    async () => {
      const harness = await createRealAppServerHarness({
        scenario: "toy-app-build-pause-rebind",
        persistentStore: true,
        useRealGitRepo: true,
      });

      try {
        await harness.dispatchTopLevelMessage({
          user: "U123",
          channel: "C08TEMPLATE",
          ts: "1710000000.0720",
          text: "Build a tiny toy app",
        });
        await waitForThreadState(harness, "1710000000.0720", "awaiting_user_input");

        await harness.dispatchAction("restart_router", {
          user: { id: "U123" },
          channel: { id: "C08TEMPLATE" },
          message: { thread_ts: "1710000000.0720" },
        });

        expect(harness.processExitCodes).toContain(RESTART_EXIT_CODE);
        await harness.bootNextGeneration();
        expect(harness.store.getThread("C08TEMPLATE", "1710000000.0720")).toMatchObject({
          state: "interrupted",
          appServerSessionStale: true,
          activeTurnId: null,
        });

        const reboundPromise = harness.dispatchThreadReply({
          user: "U123",
          channel: "C08TEMPLATE",
          ts: "1710000000.0721",
          thread_ts: "1710000000.0720",
          text: "continue after first restart",
        });
        const reboundFailure = reboundPromise.then(
          () => null,
          (error) => error,
        );

        expect(await harness.waitForRequest("thread/start", { occurrence: 2 })).toBeTruthy();
        expect(await harness.waitForRequest("turn/start", { occurrence: 2 })).toMatchObject({
          params: {
            input: [{ type: "text", text: "continue after first restart" }],
          },
        });
        await waitForArtifact(harness, {
          kind: "paused-turn-start",
          generation: 2,
          prompt: "continue after first restart",
        });
        expect(harness.store.getThread("C08TEMPLATE", "1710000000.0720")).toMatchObject({
          state: "running",
          appServerSessionStale: false,
          activeTurnId: null,
        });

        await harness.dispatchAction("restart_router", {
          user: { id: "U123" },
          channel: { id: "C08TEMPLATE" },
          message: { thread_ts: "1710000000.0720" },
        });

        expect(harness.processExitCodes.filter((code) => code === RESTART_EXIT_CODE)).toHaveLength(2);
        await harness.bootNextGeneration();

        await expect(reboundFailure).resolves.toBeInstanceOf(Error);
        expect(harness.store.getThread("C08TEMPLATE", "1710000000.0720")).toMatchObject({
          state: "interrupted",
          appServerSessionStale: true,
          activeTurnId: null,
        });

        await harness.dispatchThreadReply({
          user: "U123",
          channel: "C08TEMPLATE",
          ts: "1710000000.0722",
          thread_ts: "1710000000.0720",
          text: "continue after second restart",
        });

        expect(await harness.waitForRequest("thread/start", { occurrence: 3 })).toBeTruthy();
        expect(await harness.waitForRequest("turn/start", { occurrence: 3 })).toMatchObject({
          params: {
            input: [{ type: "text", text: "continue after second restart" }],
          },
        });
        await waitForThreadState(harness, "1710000000.0720", "awaiting_user_input");

        const freshButton = findRenderedChoiceButton(harness, "Approve");
        await harness.dispatchAction(freshButton.action_id, {
          action: {
            action_id: freshButton.action_id,
            value: freshButton.value,
          },
          user: { id: "U123" },
          channel: { id: "C08TEMPLATE" },
          message: { thread_ts: "1710000000.0720" },
        });
        expect(await harness.waitForRequest("turn/start", { occurrence: 4 })).toMatchObject({
          params: {
            input: [{ type: "text", text: "Approve" }],
          },
        });
        await waitForToyAppCompletion(harness, "1710000000.0720");

        expect(harness.store.getThread("C08TEMPLATE", "1710000000.0720")).toMatchObject({
          state: "idle",
          appServerSessionStale: false,
        });
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
  expectedState: "awaiting_user_input" | "idle",
): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (harness.store.getThread("C08TEMPLATE", threadTs)?.state === expectedState) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for thread state ${expectedState}.`);
}

async function waitForToyAppCompletion(
  harness: Awaited<ReturnType<typeof createRealAppServerHarness>>,
  threadTs: string,
): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const thread = harness.store.getThread("C08TEMPLATE", threadTs);
    const hasFileWriteArtifact = harness.readArtifacts().some(
      (artifact) => artifact.kind === "file-write" && artifact.path === "src/app.txt",
    );

    if (thread?.state === "idle" && hasFileWriteArtifact) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for toy-app completion after restart.");
}

async function waitForArtifact(
  harness: Awaited<ReturnType<typeof createRealAppServerHarness>>,
  expectedArtifact: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const match = harness.readArtifacts().find((artifact) =>
      Object.entries(expectedArtifact).every(
        ([key, value]) => (artifact as Record<string, unknown>)[key] === value,
      ),
    );
    if (match) {
      return match;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for artifact ${JSON.stringify(expectedArtifact)}.`);
}

function findRenderedChoiceButton(
  harness: Awaited<ReturnType<typeof createRealAppServerHarness>>,
  choice: string,
): { action_id: string; value: string } {
  for (const message of [...harness.slack.postedMessages].reverse()) {
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

  throw new Error(`Expected a rendered choice button for '${choice}'.`);
}
