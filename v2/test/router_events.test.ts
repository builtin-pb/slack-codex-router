import { describe, expect, it } from "vitest";
import { toRouterEventEffect } from "../src/router/events.js";

describe("toRouterEventEffect", () => {
  it("maps nested active status payloads onto running thread state", () => {
    expect(
      toRouterEventEffect({
        method: "thread/status/changed",
        params: {
          threadId: "thread_abc",
          status: { type: "active" },
        },
      }),
    ).toEqual({
      threadId: "thread_abc",
      state: "running",
    });
  });

  it("keeps explicit thread states without consulting nested status", () => {
    expect(
      toRouterEventEffect({
        method: "thread/status/changed",
        params: {
          threadId: "thread_abc",
          state: "failed_setup",
        },
      }),
    ).toEqual({
      threadId: "thread_abc",
      state: "failed_setup",
    });
  });

  it("falls back to nested idle status payloads", () => {
    expect(
      toRouterEventEffect({
        method: "thread/status/changed",
        params: {
          threadId: "thread_abc",
          status: { type: "idle" },
        },
      }),
    ).toEqual({
      threadId: "thread_abc",
      state: "idle",
    });
  });

  it("drops thread status changes with unrecognized nested status payloads", () => {
    expect(
      toRouterEventEffect({
        method: "thread/status/changed",
        params: {
          threadId: "thread_abc",
          status: { type: "paused" },
        },
      }),
    ).toBeNull();
  });

  it("uses the top-level text field for user input prompts", () => {
    expect(
      toRouterEventEffect({
        method: "tool/requestUserInput",
        params: {
          threadId: "thread_abc",
          text: "Choose a branch",
        },
      }),
    ).toEqual({
      threadId: "thread_abc",
      state: "awaiting_user_input",
      message: {
        text: "Codex needs your input: Choose a branch",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*Codex needs your input*\nChoose a branch",
            },
          },
        ],
      },
    });
  });

  it("extracts prompts and options from questions arrays", () => {
    expect(
      toRouterEventEffect({
        method: "tool/requestUserInput",
        params: {
          threadId: "thread_abc",
          questions: [
            {
              id: "branch",
              header: "Repository choice",
              question: "Which branch should we use?",
              options: [
                { label: "main" },
                { label: "develop" },
                { label: " " },
              ],
            },
          ],
        },
      }),
    ).toEqual({
      threadId: "thread_abc",
      state: "awaiting_user_input",
      message: {
        text: "Codex needs your input: Repository choice\nWhich branch should we use?",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*Codex needs your input*\nRepository choice\nWhich branch should we use?",
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                action_id: "codex_choice:branch-1",
                text: {
                  type: "plain_text",
                  text: "main",
                },
                value: "main",
              },
              {
                type: "button",
                action_id: "codex_choice:branch-2",
                text: {
                  type: "plain_text",
                  text: "develop",
                },
                value: "develop",
              },
            ],
          },
        ],
      },
    });
  });

  it("extracts prompts from nested request payloads", () => {
    expect(
      toRouterEventEffect({
        method: "tool/requestUserInput",
        params: {
          threadId: "thread_abc",
          request: {
            message: "Pick an option",
          },
        },
      }),
    ).toEqual({
      threadId: "thread_abc",
      state: "awaiting_user_input",
      message: {
        text: "Codex needs your input: Pick an option",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*Codex needs your input*\nPick an option",
            },
          },
        ],
      },
    });
  });

  it("joins assistant content array parts when direct text is blank", () => {
    expect(
      toRouterEventEffect({
        method: "turn/item",
        params: {
          threadId: "thread_abc",
          item: {
            type: "message",
            role: "assistant",
            text: "   ",
            content: [
              { text: "First part" },
              { text: { message: "Second part" } },
              { value: "Third part" },
            ],
          },
        },
      }),
    ).toEqual({
      threadId: "thread_abc",
      message: {
        text: "First part\nSecond part\nThird part",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "First part\nSecond part\nThird part",
            },
          },
        ],
      },
    });
  });

  it("uses direct assistant text when it is present", () => {
    expect(
      toRouterEventEffect({
        method: "item/completed",
        params: {
          threadId: "thread_abc",
          item: {
            type: "message",
            role: "assistant",
            text: "Direct assistant text",
          },
        },
      }),
    ).toEqual({
      threadId: "thread_abc",
      message: {
        text: "Direct assistant text",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Direct assistant text",
            },
          },
        ],
      },
    });
  });

  it("uses direct agentMessage text from the current app-server protocol", () => {
    expect(
      toRouterEventEffect({
        method: "item/completed",
        params: {
          threadId: "thread_abc",
          item: {
            type: "agentMessage",
            text: "Current protocol assistant text",
            phase: "final_answer",
          },
        },
      }),
    ).toEqual({
      threadId: "thread_abc",
      message: {
        text: "Current protocol assistant text",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Current protocol assistant text",
            },
          },
        ],
      },
    });
  });

  it("drops assistant messages without usable content array parts", () => {
    expect(
      toRouterEventEffect({
        method: "item/completed",
        params: {
          threadId: "thread_abc",
          item: {
            type: "message",
            role: "assistant",
            text: "",
            content: [{}, { text: "   " }],
          },
        },
      }),
    ).toBeNull();
  });

  it("ignores non-assistant items", () => {
    expect(
      toRouterEventEffect({
        method: "turn/item",
        params: {
          threadId: "thread_abc",
          item: {
            type: "message",
            role: "user",
            text: "User text",
          },
        },
      }),
    ).toBeNull();
  });

  it("drops assistant messages without a content array", () => {
    expect(
      toRouterEventEffect({
        method: "turn/item",
        params: {
          threadId: "thread_abc",
          item: {
            type: "message",
            role: "assistant",
            text: "",
          },
        },
      }),
    ).toBeNull();
  });

  it("drops assistant messages with non-record content entries", () => {
    expect(
      toRouterEventEffect({
        method: "turn/item",
        params: {
          threadId: "thread_abc",
          item: {
            type: "message",
            role: "assistant",
            text: "",
            content: [null, "ignored"],
          },
        },
      }),
    ).toBeNull();
  });

  it("keeps item notifications that have a thread id", () => {
    expect(
      toRouterEventEffect({
        method: "item/started",
        params: {
          threadId: "thread_abc",
        },
      }),
    ).toEqual({
      threadId: "thread_abc",
    });
  });

  it("ignores item notifications that do not include a usable thread id", () => {
    expect(
      toRouterEventEffect({
        method: "item/started",
        params: {},
      }),
    ).toBeNull();
  });
});
