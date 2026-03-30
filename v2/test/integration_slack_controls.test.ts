import { describe, expect, it } from "vitest";
import { createRuntimeHarness } from "./helpers/runtime_harness.js";

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
      await harness.dispatchAction("merge_to_main", {
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
      });

      await harness.dispatchAction("confirm_merge_to_main", {
        action: {
          action_id: "confirm_merge_to_main",
          value: "codex/slack/1710000000-0001:main",
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

  it("rejects stale recovered review actions without mutating the record", async () => {
    const harness = await createRuntimeHarness({ seedIdleThread: true });

    try {
      harness.store.upsertThread({
        ...harness.store.getThread("C08TEMPLATE", "1710000000.0001")!,
        appServerSessionStale: true,
        state: "idle",
      });

      await harness.dispatchAction("review", {
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
      });

      expect(harness.actionResponses.at(-1)).toMatchObject({
        text: expect.stringContaining("new message"),
      });
      expect(harness.store.getThread("C08TEMPLATE", "1710000000.0001")).toMatchObject({
        appServerSessionStale: true,
        state: "idle",
      });
    } finally {
      harness.cleanup();
    }
  });

  it("rejects a replayed merge confirmation after the thread has already reset to base", async () => {
    const harness = await createRuntimeHarness({ seedThread: true, seedIdleThread: true });

    try {
      await harness.dispatchAction("confirm_merge_to_main", {
        action: {
          action_id: "confirm_merge_to_main",
          value: "codex/slack/1710000000-0001:main",
        },
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
      });

      await harness.dispatchAction("confirm_merge_to_main", {
        action: {
          action_id: "confirm_merge_to_main",
          value: "codex/slack/1710000000-0001:main",
        },
        user: { id: "U123" },
        channel: { id: "C08TEMPLATE" },
        message: { thread_ts: "1710000000.0001" },
      });

      expect(harness.actionResponses.at(-1)).toMatchObject({
        text: expect.stringContaining("stale"),
      });
    } finally {
      harness.cleanup();
    }
  });
});
