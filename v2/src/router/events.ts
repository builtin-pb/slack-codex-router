import type { AppServerNotification } from "../app_server/events.js";
import type { ThreadState } from "../domain/types.js";
import {
  renderAgentMessage,
  renderUserInputPrompt,
  type SlackRenderedMessage,
} from "../slack/render.js";

export type RouterEventEffect = {
  threadId: string;
  state?: ThreadState;
  message?: SlackRenderedMessage;
};

export function toRouterEventEffect(
  notification: AppServerNotification,
): RouterEventEffect | null {
  if (notification.method === "thread/status/changed") {
    const threadId = readThreadId(notification.params);
    const state = readThreadState(notification.params);
    if (!threadId || !state) {
      return null;
    }

    return {
      threadId,
      state,
    };
  }

  if (notification.method === "tool/requestUserInput") {
    const threadId = readThreadId(notification.params);
    if (!threadId) {
      return null;
    }

    const prompt = readUserInputPrompt(notification.params);
    const options = readUserInputOptions(notification.params);
    return {
      threadId,
      state: "awaiting_user_input",
      message: prompt ? renderUserInputPrompt({ prompt, options }) : undefined,
    };
  }

  if (notification.method === "turn/item" || notification.method === "item/completed") {
    const threadId = readThreadId(notification.params);
    const item = readRecord(notification.params.item);
    const text = item ? readAssistantMessageText(item) : null;
    if (!threadId || !text) {
      return null;
    }

    return {
      threadId,
      message: renderAgentMessage(text),
    };
  }

  if (notification.method.startsWith("item/")) {
    const threadId = readThreadId(notification.params);
    if (!threadId) {
      return null;
    }

    return {
      threadId,
    };
  }

  return null;
}

function readThreadId(params: Record<string, unknown>): string | null {
  return typeof params.threadId === "string" ? params.threadId : null;
}

function readThreadState(params: Record<string, unknown>): ThreadState | null {
  switch (params.state) {
    case "idle":
    case "running":
    case "awaiting_user_input":
    case "interrupted":
    case "failed_setup":
      return params.state;
    default:
      break;
  }

  const status = readRecord(params.status);
  switch (status?.type) {
    case "idle":
      return "idle";
    case "active":
      return "running";
    default:
      return null;
  }
}

function readUserInputPrompt(params: Record<string, unknown>): string | null {
  const questionPrompt = readQuestionPrompt(params.questions);
  if (questionPrompt?.trim()) {
    return questionPrompt.trim();
  }

  const prompt =
    readText(params.prompt) ??
    readText(params.text) ??
    readText(params.message) ??
    readNestedText(params.request) ??
    readNestedText(params.input) ??
    readNestedText(params.inputRequest);

  return prompt?.trim() ? prompt.trim() : null;
}

function readUserInputOptions(
  params: Record<string, unknown>,
): Array<{ id: string; label: string; value: string }> {
  const questions = Array.isArray(params.questions) ? params.questions : [];
  const firstQuestion = questions
    .map((question) => readRecord(question))
    .find((question): question is Record<string, unknown> => Boolean(question));

  if (!firstQuestion) {
    return [];
  }

  const questionId = readText(firstQuestion.id)?.trim() || "choice";
  const options = Array.isArray(firstQuestion.options) ? firstQuestion.options : [];

  return options
    .map((option, index) => {
      const record = readRecord(option);
      const label = record ? readText(record.label)?.trim() : null;
      if (!label) {
        return null;
      }

      return {
        id: `${questionId}-${index + 1}`,
        label,
        value: label,
      };
    })
    .filter((option): option is { id: string; label: string; value: string } => Boolean(option));
}

function readQuestionPrompt(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const firstQuestion = value
    .map((entry) => readRecord(entry))
    .find((entry): entry is Record<string, unknown> => Boolean(entry));

  if (!firstQuestion) {
    return null;
  }

  const header = readText(firstQuestion.header)?.trim();
  const question = readText(firstQuestion.question)?.trim();
  if (!question) {
    return null;
  }

  return header ? `${header}\n${question}` : question;
}

function readNestedText(value: unknown): string | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  return (
    readText(record.prompt) ??
    readText(record.text) ??
    readText(record.message) ??
    null
  );
}

function readAssistantMessageText(item: Record<string, unknown>): string | null {
  if (item.type !== "message" || item.role !== "assistant") {
    return null;
  }

  const directText = readText(item.text);
  if (directText?.trim()) {
    return directText.trim();
  }

  const content = item.content;
  if (!Array.isArray(content)) {
    return null;
  }

  const parts = content
    .map((entry) => {
      const record = readRecord(entry);
      if (!record) {
        return null;
      }

      return (
        readText(record.text) ??
        readNestedText(record.text) ??
        readText(record.value) ??
        null
      );
    })
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());

  if (parts.length === 0) {
    return null;
  }

  return parts.join("\n");
}

function readText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
