import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ThreadRecord } from "../../src/domain/types.js";
import { createRealAppServerHarness } from "./real_app_server_harness.js";

type ScenarioName = "toy-app-build";

export async function createRealScenarioFixture(options: {
  scenario: ScenarioName;
}) {
  const harness = await createRealAppServerHarness({
    scenario: options.scenario,
    persistentStore: true,
    useRealGitRepo: true,
  });
  let primaryThreadTs: string | null = null;
  let primaryChannelId: string | null = null;

  return {
    ...harness,
    async dispatchTopLevelMessage(input: {
      user: string;
      channel: string;
      ts: string;
      text: string;
    }) {
      primaryThreadTs = input.ts;
      primaryChannelId = input.channel;
      await harness.dispatchTopLevelMessage(input);
    },
    async dispatchChoice(choice: string) {
      if (!primaryThreadTs || !primaryChannelId) {
        throw new Error("Top-level message must be dispatched before choosing.");
      }

      const button = findRenderedChoiceButton(choice);

      await harness.dispatchAction(button.action_id, {
        action: {
          action_id: button.action_id,
          value: button.value,
        },
        user: { id: "U123" },
        channel: { id: primaryChannelId },
        message: { thread_ts: primaryThreadTs },
      });
    },
    async dispatchStaleChoice(choice: string) {
      if (!primaryThreadTs || !primaryChannelId) {
        throw new Error("Top-level message must be dispatched before choosing.");
      }

      const thread = harness.store.getThread(primaryChannelId, primaryThreadTs);
      if (!thread) {
        throw new Error("Expected stored thread before marking it stale.");
      }

      harness.store.upsertThread({
        ...thread,
        appServerSessionStale: true,
        state: "interrupted",
        activeTurnId: null,
      });

      const button = findRenderedChoiceButton(choice);

      await harness.dispatchAction(button.action_id, {
        action: {
          action_id: button.action_id,
          value: button.value,
        },
        user: { id: "U123" },
        channel: { id: primaryChannelId },
        message: { thread_ts: primaryThreadTs },
      });
    },
    async waitForScenarioPause(expectedState: "awaiting-user-input") {
      if (!primaryThreadTs || !primaryChannelId) {
        throw new Error("Top-level message must be dispatched before waiting.");
      }

      await waitFor(() => {
        const thread = getPrimaryThread();
        return thread?.state === toStoreState(expectedState);
      });
    },
    async waitForScenarioCompletion() {
      if (!primaryThreadTs || !primaryChannelId) {
        throw new Error("Top-level message must be dispatched before waiting.");
      }

      await waitFor(() => {
        const artifact = readLatestFileWriteArtifact();
        return Boolean(
          artifact &&
            artifact.path === "src/app.txt" &&
            typeof artifact.cwd === "string" &&
            existsSync(join(artifact.cwd, artifact.path)),
        );
      });

      await waitFor(() => {
        const thread = getPrimaryThread();
        return thread?.state === "idle";
      });
    },
    async readProjectFile(relativePath: string) {
      const thread = getPrimaryThread();
      const cwd = readLatestFileWriteCwd() ?? thread?.worktreePath ?? harness.projectDir;
      return readFileSync(join(cwd, relativePath), "utf8");
    },
    transcript() {
      return [
        ...harness.slack.postedMessages.map((message) => ({
          kind: "slack-message",
          text: typeof message.text === "string" ? message.text : "",
          thread_ts: message.thread_ts,
        })),
        ...harness.readArtifacts(),
      ];
    },
    latestActionResponse() {
      return harness.latestActionResponse();
    },
  };

  function getPrimaryThread(): ThreadRecord | null {
    if (!primaryThreadTs || !primaryChannelId) {
      return null;
    }

    return harness.store.getThread(primaryChannelId, primaryThreadTs);
  }

  function readLatestFileWriteCwd(): string | null {
    const artifact = readLatestFileWriteArtifact();
    return artifact?.cwd ?? null;
  }

  function readLatestFileWriteArtifact(): { cwd?: string; path?: string } | null {
    const artifact = [...harness.readArtifacts()]
      .reverse()
      .find(
        (entry) =>
          entry.kind === "file-write" &&
          typeof entry.path === "string" &&
          entry.path.length > 0,
      );

    return artifact ?? null;
  }

  function findRenderedChoiceButton(choice: string): { action_id: string; value: string } {
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
}

function toStoreState(state: "awaiting-user-input"): "awaiting_user_input" {
  return state === "awaiting-user-input" ? "awaiting_user_input" : "awaiting_user_input";
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 3000; attempt += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for scenario condition.");
}
