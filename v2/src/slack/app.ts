import type { RouterService } from "../router/service.js";

type SlackMessageEvent = {
  channel: string;
  ts: string;
  thread_ts?: string;
  text?: string;
  user?: string;
  subtype?: string;
};

type SayFn = (message: { text: string; thread_ts: string }) => Promise<unknown>;

type SlackMessageApp = {
  event(
    name: "message",
    listener: (args: { event: SlackMessageEvent; say: SayFn }) => Promise<void>,
  ): void;
};

export function registerSlackMessageHandler(
  app: SlackMessageApp,
  router: RouterService,
): void {
  app.event("message", async ({ event, say }) => {
    if (event.subtype) {
      return;
    }

    const threadTs = event.thread_ts ?? event.ts;

    await router.handleSlackMessage({
      channelId: event.channel,
      messageTs: event.ts,
      threadTs,
      text: event.text ?? "",
      userId: event.user ?? "",
      reply: async (message) => {
        await say({
          text: message,
          thread_ts: threadTs,
        });
      },
    });
  });
}
