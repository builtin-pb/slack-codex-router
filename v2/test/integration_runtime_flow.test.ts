import { describe, expect, it } from "vitest";
import { createRuntimeHarness } from "./helpers/runtime_harness.js";

describe("integrated runtime flow", () => {
  it("creates a thread mapping, starts a turn, and posts runtime output into the same slack thread", async () => {
    const harness = await createRuntimeHarness();

    try {
      await harness.dispatchTopLevelMessage({
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0001",
        text: "Investigate the repo",
      });

      harness.emitNotification({
        method: "thread/status/changed",
        params: { threadId: "thread_abc", state: "running" },
      });
      harness.emitNotification({
        method: "item/completed",
        params: {
          threadId: "thread_abc",
          item: { type: "agentMessage", text: "Working on it.", phase: "commentary" },
        },
      });

      expect(harness.store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
        appServerThreadId: "thread_abc",
        activeTurnId: "turn_abc",
        state: "running",
      });
      expect(harness.slack.postedMessages.at(-1)).toMatchObject({
        channel: "C08TEMPLATE",
        thread_ts: "1710000000.0001",
        text: "Working on it.",
      });
    } finally {
      harness.cleanup();
    }
  });

  it("turns requestUserInput notifications into a live choice action that resumes the thread", async () => {
    const harness = await createRuntimeHarness();

    try {
      await harness.dispatchTopLevelMessage({
        user: "U123",
        channel: "C08TEMPLATE",
        ts: "1710000000.0001",
        text: "Investigate the repo",
      });

      harness.emitNotification({
        method: "tool/requestUserInput",
        params: {
          threadId: "thread_abc",
          questions: [
            {
              id: "approval",
              header: "Decision",
              question: "Choose one",
              options: [{ label: "Approve" }, { label: "Deny" }],
            },
          ],
        },
      });

      const choiceButton = findChoiceButton(harness.slack.postedMessages.at(-1));
      expect(choiceButton).toMatchObject({
        action_id: expect.stringMatching(/^codex_choice:\d+:/),
        value: expect.stringMatching(/^\d+:/),
      });

      await harness.dispatchAction(choiceButton.action_id, {
        action: {
          action_id: choiceButton.action_id,
          value: choiceButton.value,
        },
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
      });

      expect(harness.store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
        state: "running",
        activeTurnId: "turn_abc",
      });
    } finally {
      harness.cleanup();
    }
  });
});

function findChoiceButton(message: Record<string, unknown> | undefined): {
  action_id: string;
  value: string;
} {
  const blocks = Array.isArray(message?.blocks) ? message.blocks : [];

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
      if (
        typeof actionId === "string" &&
        actionId.startsWith("codex_choice:") &&
        typeof value === "string"
      ) {
        return { action_id: actionId, value };
      }
    }
  }

  throw new Error("Expected a rendered codex choice button in the latest Slack message.");
}
