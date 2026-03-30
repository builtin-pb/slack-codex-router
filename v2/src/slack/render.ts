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
  prompt: string;
  options?: UserInputOption[];
}): SlackRenderedMessage {
  const header = "*Codex needs your input*";
  const promptText = `${header}\n${input.prompt}`;

  return {
    text: `Codex needs your input: ${input.prompt}`,
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
): SlackRenderedMessage {
  return {
    ...message,
    blocks: [...(message.blocks ?? []), ...buildThreadControls(toThreadControlState(threadState))],
  };
}

function toThreadControlState(state: ThreadState): {
  canInterrupt: boolean;
  canReview: boolean;
  canMerge: boolean;
} {
  return {
    canInterrupt: state === "running",
    canReview: state === "idle",
    canMerge: state === "idle",
  };
}
