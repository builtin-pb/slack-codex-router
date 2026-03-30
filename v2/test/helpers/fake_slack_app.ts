type SlackMessageHandler = (args: {
  event: Record<string, unknown>;
  say: (message: { text: string; thread_ts: string }) => Promise<unknown>;
}) => Promise<void>;

type SlackActionHandler = (args: {
  ack: () => Promise<unknown>;
  respond: (message: {
    text: string;
    replace_original?: boolean;
    blocks?: unknown[];
  }) => Promise<unknown>;
  body: Record<string, unknown>;
  action?: { action_id?: string; value?: string };
}) => Promise<void>;

type RegisteredAction = {
  matcher: string | RegExp;
  handler: SlackActionHandler;
};

export function createFakeSlackApp() {
  const postedMessages: Array<Record<string, unknown>> = [];
  const saidMessages: Array<Record<string, unknown>> = [];
  const registeredActions: RegisteredAction[] = [];
  let messageHandler: SlackMessageHandler | null = null;

  const app = {
    event(name: "message", handler: SlackMessageHandler) {
      if (name === "message") {
        messageHandler = handler;
      }
    },
    action(matcher: string | RegExp, handler: SlackActionHandler) {
      registeredActions.push({ matcher, handler });
    },
    start: async () => undefined,
    client: {
      chat: {
        postMessage: async (message: Record<string, unknown>) => {
          postedMessages.push(message);
        },
      },
    },
  };

  return {
    app,
    postedMessages,
    saidMessages,
    get messageHandler() {
      return messageHandler;
    },
    getAction(actionId: string): SlackActionHandler | null {
      for (const entry of registeredActions) {
        if (typeof entry.matcher === "string" && entry.matcher === actionId) {
          return entry.handler;
        }

        if (entry.matcher instanceof RegExp && entry.matcher.test(actionId)) {
          return entry.handler;
        }
      }

      return null;
    },
    async dispatchMessage(event: Parameters<SlackMessageHandler>[0]["event"]): Promise<void> {
      if (!messageHandler) {
        throw new Error("No Slack message handler registered.");
      }

      await messageHandler({
        event,
        say: async (message) => {
          saidMessages.push(message);
          return undefined;
        },
      });
    },
    async dispatchAction(
      actionId: string,
      body: Record<string, unknown>,
      options: {
        respond?: (message: {
          text: string;
          replace_original?: boolean;
          blocks?: unknown[];
        }) => Promise<unknown>;
        action?: { action_id?: string; value?: string };
      } = {},
    ): Promise<void> {
      const handler = this.getAction(actionId);
      if (!handler) {
        throw new Error(`No Slack action handler registered for '${actionId}'.`);
      }

      await handler({
        ack: async () => undefined,
        respond: options.respond ?? (async () => undefined),
        body,
        action: options.action ?? { action_id: actionId },
      });
    },
    registeredActions,
  };
}
