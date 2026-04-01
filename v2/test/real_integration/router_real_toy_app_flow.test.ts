import { describe, expect, it } from "vitest";
import { createRealScenarioFixture } from "../helpers/real_scenario_fixture.js";

describe("deterministic toy-app build scenario", () => {
  it(
    "builds a toy app across multiple rounds with a real router, real child process, and real file edits",
    async () => {
      const fixture = await createRealScenarioFixture({
        scenario: "toy-app-build",
      });

      try {
        await fixture.dispatchTopLevelMessage({
          user: "U123",
          channel: "C08TEMPLATE",
          ts: "1710000000.0100",
          text: "Build a tiny toy app",
        });

        await fixture.waitForScenarioPause("awaiting-user-input");
        await fixture.dispatchChoice("Approve");
        await fixture.waitForScenarioCompletion();

        expect(await fixture.readProjectFile("src/app.txt")).toContain("toy app ready");
        expect(await fixture.waitForRequest("thread/start")).toMatchObject({
          params: {
            cwd: expect.stringContaining(".codex-worktrees/1710000000-0100"),
          },
        });
        expect(await fixture.waitForRequest("turn/start", { occurrence: 2 })).toMatchObject({
          params: {
            cwd: expect.stringContaining(".codex-worktrees/1710000000-0100"),
            input: [{ type: "text", text: "Approve" }],
          },
        });
        expect(fixture.store.getThread("C08TEMPLATE", "1710000000.0100")).toMatchObject({
          state: "idle",
          appServerSessionStale: false,
        });
        expect(fixture.transcript()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: "slack-message" }),
            expect.objectContaining({ kind: "request-user-input" }),
            expect.objectContaining({ kind: "file-write", path: "src/app.txt" }),
          ]),
        );
      } finally {
        await fixture.cleanup();
      }
    },
    30000,
  );

  it(
    "collapses a burst of duplicate first-message deliveries at the real harness boundary",
    async () => {
      const fixture = await createRealScenarioFixture({
        scenario: "toy-app-build",
      });

      try {
        const dispatches = Array.from({ length: 5 }, () =>
          fixture.dispatchTopLevelMessage({
            user: "U123",
            channel: "C08TEMPLATE",
            ts: "1710000000.0103",
            text: "Build a tiny toy app",
          }),
        );

        await fixture.waitForRequest("turn/start");
        await fixture.waitForScenarioPause("awaiting-user-input");
        await Promise.all(dispatches);

        const saidTexts = fixture.slack.saidMessages.map((message) =>
          typeof message.text === "string" ? message.text : "",
        );

        expect(saidTexts).toHaveLength(5);
        expect(
          saidTexts.filter((text) => text === "Started Codex task for project `template`."),
        ).toHaveLength(1);
        expect(
          saidTexts.filter((text) => text === "This Slack thread already has a running Codex turn."),
        ).toHaveLength(4);
        expect(fixture.store.getThread("C08TEMPLATE", "1710000000.0103")).toMatchObject({
          state: "awaiting_user_input",
          appServerSessionStale: false,
        });
      } finally {
        await fixture.cleanup();
      }
    },
    30000,
  );

  it(
    "rejects replayed choice actions after the scenario has already completed",
    async () => {
      const fixture = await createRealScenarioFixture({
        scenario: "toy-app-build",
      });

      try {
        await fixture.dispatchTopLevelMessage({
          user: "U123",
          channel: "C08TEMPLATE",
          ts: "1710000000.0101",
          text: "Build a tiny toy app",
        });

        await fixture.waitForScenarioPause("awaiting-user-input");
        await fixture.dispatchChoice("Approve");
        await fixture.waitForScenarioCompletion();
        await fixture.dispatchChoice("Approve");

        expect(fixture.latestActionResponse()).toMatchObject({
          text: "This Slack thread is not waiting for a choice.",
        });
        expect(fixture.store.getThread("C08TEMPLATE", "1710000000.0101")).toMatchObject({
          state: "idle",
          appServerSessionStale: false,
        });
      } finally {
        await fixture.cleanup();
      }
    },
    30000,
  );

  it(
    "rejects stale choice actions without mutating the interrupted record",
    async () => {
      const fixture = await createRealScenarioFixture({
        scenario: "toy-app-build",
      });

      try {
        await fixture.dispatchTopLevelMessage({
          user: "U123",
          channel: "C08TEMPLATE",
          ts: "1710000000.0102",
          text: "Build a tiny toy app",
        });

        await fixture.waitForScenarioPause("awaiting-user-input");
        await fixture.dispatchStaleChoice("Approve");

        expect(fixture.latestActionResponse()).toMatchObject({
          text: "This Slack thread needs a new message to refresh the Codex session.",
        });
        expect(fixture.store.getThread("C08TEMPLATE", "1710000000.0102")).toMatchObject({
          state: "interrupted",
          appServerSessionStale: true,
          activeTurnId: null,
        });
      } finally {
        await fixture.cleanup();
      }
    },
    30000,
  );
});
