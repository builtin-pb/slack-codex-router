import { describe, expect, it, vi } from "vitest";
import { createRuntimeHarness } from "./helpers/runtime_harness.js";

function getLatestMergeConfirmationValue(
  actionResponses: Array<Record<string, unknown>>,
): string {
  const blocks = actionResponses.at(-1)?.blocks;
  if (!Array.isArray(blocks)) {
    throw new Error("Expected merge preview blocks in the latest action response.");
  }

  for (const block of blocks) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const elements = (block as { elements?: unknown }).elements;
    if (!Array.isArray(elements)) {
      continue;
    }

    for (const element of elements) {
      if (
        element &&
        typeof element === "object" &&
        (element as { action_id?: unknown }).action_id === "confirm_merge_to_main" &&
        typeof (element as { value?: unknown }).value === "string"
      ) {
        return (element as { value: string }).value;
      }
    }
  }

  throw new Error("Expected confirm_merge_to_main button payload in preview response.");
}

function getLatestMergePreviewPayload(
  postedMessages: Array<Record<string, unknown>>,
): { action_id: string; value: string } {
  const blocks = postedMessages.at(-1)?.blocks;
  if (!Array.isArray(blocks)) {
    throw new Error("Expected merge preview blocks in the latest posted message.");
  }

  for (const block of blocks) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const elements = (block as { elements?: unknown }).elements;
    if (!Array.isArray(elements)) {
      continue;
    }

    for (const element of elements) {
      if (
        element &&
        typeof element === "object" &&
        (element as { action_id?: unknown }).action_id === "merge_to_main" &&
        typeof (element as { value?: unknown }).value === "string"
      ) {
        return {
          action_id: (element as { action_id: string }).action_id,
          value: (element as { value: string }).value,
        };
      }
    }
  }

  throw new Error("Expected merge_to_main button payload in posted message.");
}

describe("integrated slack controls", () => {
  it("registers live slack actions that operate on real persisted thread state", async () => {
    const harness = await createRuntimeHarness({ seedThread: true });

    try {
      await harness.dispatchAction("status", {
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
      });

      expect(harness.actionResponses[0]).toMatchObject({
        text: expect.stringContaining("State: idle"),
      });
    } finally {
      harness.cleanup();
    }
  });

  it("resolves top-level controls via message.ts when thread_ts is absent", async () => {
    const harness = await createRuntimeHarness({ seedThread: true });

    try {
      await harness.dispatchAction("status", {
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { ts: "1710000000.0001" },
      });

      expect(harness.actionResponses[0]).toMatchObject({
        text: expect.stringContaining("State: idle"),
      });
    } finally {
      harness.cleanup();
    }
  });

  it("runs merge preview and merge confirm through live Slack actions", async () => {
    const harness = await createRuntimeHarness({ seedThread: true, seedIdleThread: true });

    try {
      harness.emitNotification({
        method: "item/completed",
        params: {
          threadId: "thread_abc",
          item: {
            type: "agentMessage",
            text: "Ready to merge.",
            phase: "commentary",
          },
        },
      });
      await harness.dispatchAction("merge_to_main", {
        action: { action_id: "merge_to_main", value: "merge_to_main:thread_abc" },
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
      });
      const confirmValue = getLatestMergeConfirmationValue(harness.actionResponses);

      await harness.dispatchAction("confirm_merge_to_main", {
        action: {
          action_id: "confirm_merge_to_main",
          value: confirmValue,
        },
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
      });

      expect(harness.store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
        branchName: "main",
        appServerSessionStale: true,
      });
    } finally {
      harness.cleanup();
    }
  });

  it("rejects a stale merge opener when a later idle session reuses the same Slack thread", async () => {
    const harness = await createRuntimeHarness({ seedIdleThread: true });

    try {
      harness.emitNotification({
        method: "item/completed",
        params: {
          threadId: "thread_abc",
          item: {
            type: "agentMessage",
            text: "Ready to merge.",
            phase: "commentary",
          },
        },
      });

      const staleMerge = getLatestMergePreviewPayload(harness.slack.postedMessages);

      harness.store.upsertThread({
        ...harness.store.getThread("C08TEMPLATE", "1710000000.0001")!,
        state: "idle",
        appServerThreadId: "thread_new",
      });

      await harness.dispatchAction(staleMerge.action_id, {
        action: staleMerge,
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
      });

      expect(harness.actionResponses.at(-1)).toMatchObject({
        text: "Merge preview control is stale. Request a fresh merge preview.",
      });
      expect(harness.actionResponses.at(-1)).not.toMatchObject({
        text: expect.stringContaining("Merge codex/slack/1710000000-0001 into main?"),
      });
      expect(harness.store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
        state: "idle",
        appServerThreadId: "thread_new",
      });
    } finally {
      harness.cleanup();
    }
  });

  it("rejects stale recovered choice clicks without mutating the record", async () => {
    const harness = await createRuntimeHarness({ seedAwaitingUserInputThread: true });

    try {
      harness.store.upsertThread({
        ...harness.store.getThread("C08TEMPLATE", "1710000000.0001")!,
        appServerSessionStale: true,
        state: "interrupted",
        activeTurnId: null,
      });

      await harness.dispatchAction("codex_choice:approval-1", {
        action: { action_id: "codex_choice:approval-1", value: "Approve" },
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
      });

      expect(harness.actionResponses.at(-1)).toMatchObject({
        text: expect.stringContaining("new message"),
      });
      expect(harness.store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
        appServerSessionStale: true,
        state: "interrupted",
      });
    } finally {
      harness.cleanup();
    }
  });

  it("rejects a stale interrupt click without interrupting the newer running turn", async () => {
    const harness = await createRuntimeHarness({ seedThread: true });
    const turnInterrupt = vi.fn().mockResolvedValue(undefined);
    (harness.routerService as unknown as { options: { turnInterrupt?: typeof turnInterrupt } }).options.turnInterrupt =
      turnInterrupt;

    try {
      harness.store.upsertThread({
        ...harness.store.getThread("C08TEMPLATE", "1710000000.0001")!,
        state: "running",
        activeTurnId: "turn_old",
      });

      harness.emitNotification({
        method: "item/completed",
        params: {
          threadId: "thread_abc",
          item: {
            type: "agentMessage",
            text: "Working on it.",
            phase: "commentary",
          },
        },
      });

      const staleInterrupt = getLatestInterruptPayload(harness.slack.postedMessages);

      harness.store.upsertThread({
        ...harness.store.getThread("C08TEMPLATE", "1710000000.0001")!,
        state: "running",
        activeTurnId: "turn_new",
      });

      await harness.dispatchAction(staleInterrupt.action_id, {
        action: staleInterrupt,
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
      });

      expect(harness.actionResponses.at(-1)).toMatchObject({
        text: "Interrupt control is stale. Request the latest update and try again.",
      });
      expect(turnInterrupt).not.toHaveBeenCalled();
      expect(harness.store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
        state: "running",
        activeTurnId: "turn_new",
      });
    } finally {
      harness.cleanup();
    }
  });

  it("rejects a stale review click without starting review on the newer idle thread", async () => {
    const harness = await createRuntimeHarness({ seedIdleThread: true });

    try {
      harness.emitNotification({
        method: "item/completed",
        params: {
          threadId: "thread_abc",
          item: {
            type: "agentMessage",
            text: "Ready for review.",
            phase: "commentary",
          },
        },
      });

      const staleReview = getLatestReviewPayload(harness.slack.postedMessages);

      harness.store.upsertThread({
        ...harness.store.getThread("C08TEMPLATE", "1710000000.0001")!,
        state: "idle",
        appServerThreadId: "thread_new",
      });

      await harness.dispatchAction(staleReview.action_id, {
        action: staleReview,
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
      });

      expect(harness.actionResponses.at(-1)).toMatchObject({
        text: "Review control is stale. Request the latest update and try again.",
      });
      expect(harness.store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
        state: "idle",
        appServerThreadId: "thread_new",
        activeTurnId: null,
      });
    } finally {
      harness.cleanup();
    }
  });

  it("rejects a replayed merge confirmation after the thread has already reset to base", async () => {
    const harness = await createRuntimeHarness({ seedThread: true, seedIdleThread: true });

    try {
      harness.emitNotification({
        method: "item/completed",
        params: {
          threadId: "thread_abc",
          item: {
            type: "agentMessage",
            text: "Ready to merge.",
            phase: "commentary",
          },
        },
      });
      await harness.dispatchAction("merge_to_main", {
        action: { action_id: "merge_to_main", value: "merge_to_main:thread_abc" },
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
      });
      const confirmValue = getLatestMergeConfirmationValue(harness.actionResponses);

      await harness.dispatchAction("confirm_merge_to_main", {
        action: {
          action_id: "confirm_merge_to_main",
          value: confirmValue,
        },
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
      });

      await harness.dispatchAction("confirm_merge_to_main", {
        action: {
          action_id: "confirm_merge_to_main",
          value: confirmValue,
        },
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
      });

      expect(harness.actionResponses.at(-1)).toMatchObject({
        text: expect.stringContaining("needs a new message"),
      });
    } finally {
      harness.cleanup();
    }
  });
});

function getLatestInterruptPayload(
  postedMessages: Array<Record<string, unknown>>,
): { action_id: string; value: string } {
  const blocks = postedMessages.at(-1)?.blocks;
  if (!Array.isArray(blocks)) {
    throw new Error("Expected thread control blocks in the latest posted message.");
  }

  for (const block of blocks) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const elements = (block as { elements?: unknown }).elements;
    if (!Array.isArray(elements)) {
      continue;
    }

    for (const element of elements) {
      if (
        element &&
        typeof element === "object" &&
        (element as { action_id?: unknown }).action_id === "interrupt" &&
        typeof (element as { value?: unknown }).value === "string"
      ) {
        return {
          action_id: "interrupt",
          value: (element as { value: string }).value,
        };
      }
    }
  }

  throw new Error("Expected interrupt button payload in the latest posted message.");
}

function getLatestReviewPayload(
  postedMessages: Array<Record<string, unknown>>,
): { action_id: string; value: string } {
  const blocks = postedMessages.at(-1)?.blocks;
  if (!Array.isArray(blocks)) {
    throw new Error("Expected thread control blocks in the latest posted message.");
  }

  for (const block of blocks) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const elements = (block as { elements?: unknown }).elements;
    if (!Array.isArray(elements)) {
      continue;
    }

    for (const element of elements) {
      if (
        element &&
        typeof element === "object" &&
        (element as { action_id?: unknown }).action_id === "review" &&
        typeof (element as { value?: unknown }).value === "string"
      ) {
        return {
          action_id: "review",
          value: (element as { value: string }).value,
        };
      }
    }
  }

  throw new Error("Expected review button payload in the latest posted message.");
}
