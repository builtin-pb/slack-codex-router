import type { ThreadState } from "../domain/types.js";
import { buildThreadControls, buildUserInputBlocks, type SlackBlock } from "./blocks.js";

type UserInputOption = {
  id: string;
  label: string;
  value?: string;
};

export type SlackRenderedMessage = {
  text: string;
  blocks?: SlackBlock[];
};

export function renderUnauthorizedUser(): string {
  return "User is not allowed to control this router.";
}

export function renderUnknownChannel(): string {
  return "This channel is not registered to a project.";
}

export function renderMissingSession(): string {
  return "This thread has no stored Codex session yet.";
}

export function renderEmptyMessage(): string {
  return "Send a non-empty message to start or continue a task.";
}

export function renderStartedTask(projectName: string): string {
  return `Started Codex task for project \`${projectName}\`.`;
}

export function renderContinuedTask(projectName: string): string {
  return `Continuing Codex task for project \`${projectName}\`.`;
}

export function renderRunningTurn(): string {
  return "This Slack thread already has a running Codex turn.";
}

export function renderAgentMessage(text: string): SlackRenderedMessage {
  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text,
        },
      },
    ],
  };
}

export function renderUserInputPrompt(input: {
  prompt?: string | null;
  options?: UserInputOption[];
}): SlackRenderedMessage {
  const header = "*Codex needs your input*";
  const prompt = input.prompt?.trim() ?? "";
  const promptText = prompt ? `${header}\n${prompt}` : header;

  return {
    text: prompt ? `Codex needs your input: ${prompt}` : "Codex needs your input",
    blocks:
      input.options && input.options.length > 0
        ? buildUserInputBlocks({
            prompt: promptText,
            options: input.options,
          })
        : [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: promptText,
              },
            },
          ],
  };
}

export function withThreadControls(
  message: SlackRenderedMessage,
  threadState: ThreadState,
  activeTurnId?: string | null,
  appServerThreadId?: string | null,
): SlackRenderedMessage {
  return {
    ...message,
    blocks: [
      ...(message.blocks ?? []),
      ...buildThreadControls(
        toThreadControlState(threadState, activeTurnId, appServerThreadId),
      ),
    ],
  };
}

function toThreadControlState(
  state: ThreadState,
  activeTurnId?: string | null,
  appServerThreadId?: string | null,
): {
  canInterrupt: boolean;
  interruptTurnId?: string | null;
  canReview: boolean;
  reviewThreadId?: string | null;
  canMerge: boolean;
  mergeThreadId?: string | null;
} {
  return {
    canInterrupt: state === "running",
    interruptTurnId: state === "running" ? activeTurnId : null,
    canReview: state === "idle",
    reviewThreadId: state === "idle" ? appServerThreadId : null,
    canMerge: state === "idle",
    mergeThreadId: state === "idle" ? appServerThreadId : null,
  };
}
