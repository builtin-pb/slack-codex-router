import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createLiveCodexHarness, isLiveCodexEnabled } from "../helpers/live_codex_harness.js";
import { LIVE_CODEX_TOY_APP_RUBRIC } from "../helpers/live_codex_judge_rubric.js";

const v2Root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const packageJsonPath = resolve(v2Root, "package.json");
const liveCodexConfigPath = resolve(v2Root, "vitest.live-codex.config.ts");
const workerPromptPath = resolve(
  v2Root,
  "test/fixtures/live_codex_worker_prompt.md",
);
const judgePromptPath = resolve(
  v2Root,
  "test/fixtures/live_codex_judge_prompt.md",
);
const fakeWorkerPath = resolve(v2Root, "test/fixtures/live_codex_fake_worker.mjs");
const clarificationWorkerPath = resolve(
  v2Root,
  "test/fixtures/live_codex_fake_worker_clarification.mjs",
);
const freeTextWorkerPath = resolve(
  v2Root,
  "test/fixtures/live_codex_fake_worker_free_text.mjs",
);
const freshBurstWorkerPath = resolve(
  v2Root,
  "test/fixtures/live_codex_fake_worker_fresh_burst.mjs",
);
const fakeJudgePath = resolve(v2Root, "test/fixtures/live_codex_fake_judge.mjs");
const freshBurstJudgePath = resolve(
  v2Root,
  "test/fixtures/live_codex_fake_judge_fresh_burst.mjs",
);
const harnessPath = resolve(v2Root, "test/helpers/live_codex_harness.ts");
const artifactsPath = resolve(v2Root, "test/helpers/live_codex_artifacts.ts");

describe("live codex test lane contract", () => {
  it("declares a dedicated env-gated live codex suite with its own scaffold files", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["test:live-codex"]).toBe(
      "vitest run --config vitest.live-codex.config.ts",
    );
    expect(packageJson.scripts?.["test:live-codex:fixtures"]).toBe(
      'LIVE_CODEX_E2E=1 LIVE_CODEX_VARIANT=fresh-burst LIVE_CODEX_WORKER_CMD="node $(pwd)/test/fixtures/live_codex_fake_worker_fresh_burst.mjs" LIVE_CODEX_JUDGE_CMD="node $(pwd)/test/fixtures/live_codex_fake_judge_fresh_burst.mjs" vitest run --config vitest.live-codex.config.ts',
    );
    expect(existsSync(liveCodexConfigPath)).toBe(true);
    expect(existsSync(workerPromptPath)).toBe(true);
    expect(existsSync(judgePromptPath)).toBe(true);
    expect(existsSync(fakeWorkerPath)).toBe(true);
    expect(existsSync(clarificationWorkerPath)).toBe(true);
    expect(existsSync(freeTextWorkerPath)).toBe(true);
    expect(existsSync(freshBurstWorkerPath)).toBe(true);
    expect(existsSync(fakeJudgePath)).toBe(true);
    expect(existsSync(freshBurstJudgePath)).toBe(true);
    expect(existsSync(harnessPath)).toBe(true);
    expect(existsSync(artifactsPath)).toBe(true);
  });

  it("describes the live worker as a stateless observation loop with normal and adversarial variants", () => {
    const workerPrompt = readFileSync(workerPromptPath, "utf8");
    const judgePrompt = readFileSync(judgePromptPath, "utf8");

    expect(workerPrompt).toContain("stateless live user agent");
    expect(workerPrompt).toContain("JSON observation envelope");
    expect(workerPrompt).toContain("exactly one JSON action");
    expect(workerPrompt).toContain("send_top_level_message");
    expect(workerPrompt).toContain("send_thread_reply");
    expect(workerPrompt).toContain("click_control");
    expect(workerPrompt).toContain("finish");
    expect(workerPrompt).toContain("Variant 1: normal toy-app build.");
    expect(workerPrompt).toContain(
      "Variant 2: adversarial easy-to-break recovery and duplicate-delivery storm.",
    );
    expect(workerPrompt).toContain("duplicate thread reply");
    expect(workerPrompt).toContain("stale button");
    expect(workerPrompt).toContain("restart-before-recovery");
    expect(workerPrompt).toContain("exactly one JSON action line");

    expect(judgePrompt).toContain("stateless observation/action loop");
    expect(judgePrompt).toContain("normal variant");
    expect(judgePrompt).toContain("adversarial duplicate-delivery storm");
    expect(judgePrompt).toContain("once before restart and once after restart");
    expect(judgePrompt).toContain("adversarial stale-control probe");
    expect(judgePrompt).toContain("adversarial restart-before-recovery probe");
    expect(judgePrompt).toContain(
      "If the evidence does not show the normal variant plus the adversarial duplicate-delivery storm, stale-control, and restart probes, fail.",
    );

    expect(LIVE_CODEX_TOY_APP_RUBRIC.criteria.map((criterion) => criterion.id)).toEqual([
      "stateless-observation-loop",
      "normal-toy-app-build",
      "adversarial-duplicate-delivery",
      "adversarial-stale-control",
      "adversarial-restart-recovery",
      "artifact-bound",
    ]);
  });
});

describe("live codex toy app scaffold", () => {
  it.skipIf(!isLiveCodexEnabled())(
    "captures evidence for a worker and judge pass/fail decision",
    async () => {
      const useFreshBurstEnv = process.env.LIVE_CODEX_VARIANT === "fresh-burst";
      const harness = await createLiveCodexHarness();

      try {
        const execution = await harness.runToyAppScenario();
        expect(execution.worker.exitCode).toBe(0);
        expect(execution.judge.exitCode).toBe(0);
        expect(execution.worker.stderr).toContain("worker:");
        expect(execution.judge.stderr).toContain("judge:");
        expect(execution.worker.stdout).toContain('"action"');
        expect(execution.judge.stdout.trim()).toMatch(/^{"status":"pass"/);
        expect(execution.judgeVerdict).toEqual({
          status: "pass",
          reasons: [],
        });
        expect(execution.artifactBundle.rubric).toEqual(LIVE_CODEX_TOY_APP_RUBRIC);
        if (useFreshBurstEnv) {
          expect(execution.worker.stderr).toContain("worker-mode: fresh-reply-burst");
          expect(execution.worker.stdout).toContain("fresh reply burst one");
          expect(execution.artifactBundle.transcript).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ kind: "worker-observation" }),
              expect.objectContaining({ kind: "worker-action" }),
              expect.objectContaining({ kind: "slack-message" }),
              expect.objectContaining({ kind: "app-server-request" }),
              expect.objectContaining({ kind: "fresh-reply-burst-probe" }),
              expect.objectContaining({ kind: "file-write", path: "src/app.txt" }),
              expect.objectContaining({ kind: "git-diff" }),
            ]),
          );
          expect(
            execution.artifactBundle.transcript.filter(
              (entry) => entry.kind === "fresh-reply-burst-probe",
            ),
          ).toHaveLength(1);
          expect(execution.artifactBundle.objectiveChecks.freshReplyBurstAttempted).toBe(true);
          expect(execution.artifactBundle.objectiveChecks.freshReplyBurstCollapsed).toBe(true);
          expect(execution.artifactBundle.objectiveChecks.freshReplyBurstProbeCount).toBe(1);
        } else {
          expect(execution.objectiveChecks.passed).toBe(true);
          expect(execution.artifactBundle.rubric.criteria).toEqual([
            {
              id: "stateless-observation-loop",
              description:
                "The transcript shows the worker being re-invoked from a JSON observation envelope and replying with exactly one action each step.",
            },
            {
              id: "normal-toy-app-build",
              description:
                "The normal variant produces the requested toy app files and a grounded workspace diff.",
            },
            {
              id: "adversarial-duplicate-delivery",
              description:
                "The adversarial variant intentionally replays a duplicate thread reply while the turn is still running, then repeats the same duplicate thread reply again after the restart-before-recovery path, and the system collapses both safely without double-starting or corrupting state.",
            },
            {
              id: "adversarial-stale-control",
              description:
                "The adversarial variant replays a stale control after the thread has moved on and the system rejects it without corrupting state.",
            },
            {
              id: "adversarial-restart-recovery",
              description:
                "The adversarial variant triggers a restart-before-recovery path and the system recovers cleanly on the next fresh round.",
            },
            {
              id: "artifact-bound",
              description: "The verdict is based only on the captured evidence bundle.",
            },
          ]);
          expect(execution.artifactBundle.transcript).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ kind: "worker-observation" }),
              expect.objectContaining({ kind: "worker-action" }),
              expect.objectContaining({ kind: "slack-message" }),
              expect.objectContaining({ kind: "app-server-request" }),
              expect.objectContaining({ kind: "duplicate-delivery-probe" }),
              expect.objectContaining({ kind: "file-write", path: "src/app.txt" }),
              expect.objectContaining({ kind: "git-diff" }),
            ]),
          );
          expect(
            execution.artifactBundle.transcript.filter(
              (entry) => entry.kind === "duplicate-delivery-probe",
            ),
          ).toHaveLength(2);
          expect(execution.artifactBundle.variant).toBe("normal+adversarial-restart");
          expect(execution.artifactBundle.objectiveChecks.duplicateDeliveryAttempted).toBe(true);
          expect(execution.artifactBundle.objectiveChecks.duplicateDeliveryCollapsed).toBe(true);
          expect(execution.serializedArtifacts).toContain("toy app ready");
          expect(execution.serializedArtifacts).toContain("slack-message");
          expect(execution.serializedArtifacts).toContain("duplicate-delivery-probe");
        }
        expect(harness.readWorkerPrompt()).toContain("Variant 1: normal toy-app build.");
        expect(harness.readWorkerPrompt()).toContain(
          "Variant 2: adversarial easy-to-break recovery and duplicate-delivery storm.",
        );
        expect(harness.readJudgePrompt()).toContain("strict JSON");
        expect(harness.readJudgePrompt()).toContain("artifact bundle");
      } finally {
        await harness.cleanup();
      }
    },
  );

  it("runs a clarification-detour variant that survives an extra user-like reply after recovery", async () => {
    const harness = await createLiveCodexHarness({
      workerCommand: buildNodeCommand(clarificationWorkerPath),
      judgeCommand: buildInlineNodeCommand(CLARIFICATION_JUDGE_SCRIPT),
    });

    try {
      const execution = await harness.runToyAppScenario();

      expect(execution.worker.exitCode).toBe(0);
      expect(execution.judge.exitCode).toBe(0);
      expect(execution.worker.stderr).toContain("worker-mode: clarification-detour");
      expect(execution.worker.stdout).toContain("single file");
      expect(execution.worker.stdout).toContain('"action":"send_thread_reply"');
      expect(execution.judgeVerdict).toEqual({
        status: "pass",
        reasons: [],
      });
      expect(execution.objectiveChecks.duplicateDeliveryAttempted).toBe(true);
      expect(execution.worker.stdout).toContain("single file");
      expect(execution.artifactBundle.transcript).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "worker-action",
            action: expect.objectContaining({
              action: "send_thread_reply",
              text: expect.stringContaining("single file"),
            }),
          }),
          expect.objectContaining({
            kind: "app-server-request",
            method: "turn/start",
            params: expect.objectContaining({
              input: expect.arrayContaining([
                expect.objectContaining({
                  text: expect.stringContaining("single file"),
                }),
              ]),
            }),
          }),
          expect.objectContaining({
            kind: "worker-action",
            action: expect.objectContaining({
              action: "click_control",
            }),
          }),
          expect.objectContaining({
            kind: "duplicate-delivery-probe",
            collapsed: true,
          }),
          expect.objectContaining({
            kind: "file-write",
            path: "src/app.txt",
          }),
        ]),
      );
      expect(execution.serializedArtifacts).toContain("single file");
      expect(execution.serializedArtifacts).toContain("duplicate-delivery-probe");
      expect(execution.serializedArtifacts).toContain("toy app ready");
    } finally {
      await harness.cleanup();
    }
  }, 30_000);

  it("runs a free-text detour variant that types while buttons are present before recovering", async () => {
    const harness = await createLiveCodexHarness({
      workerCommand: buildNodeCommand(freeTextWorkerPath),
      judgeCommand: buildInlineNodeCommand(DUPLICATE_STORM_JUDGE_SCRIPT),
    });

    try {
      const execution = await harness.runToyAppScenario();

      expect(execution.worker.exitCode).toBe(0);
      expect(execution.judge.exitCode).toBe(0);
      expect(execution.worker.stderr).toContain("worker-mode: free-text-detour");
      expect(execution.worker.stdout).toContain("I am typing free text");
      expect(execution.worker.stdout).toContain('"action":"send_thread_reply"');
      expect(execution.judgeVerdict).toEqual({
        status: "pass",
        reasons: [],
      });
      expect(execution.objectiveChecks.duplicateDeliveryAttempted).toBe(true);
      expect(execution.objectiveChecks.duplicateDeliveryCollapsed).toBe(true);
      expect(execution.artifactBundle.transcript).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "worker-action",
            action: expect.objectContaining({
              action: "send_thread_reply",
              text: expect.stringContaining("I am typing free text"),
            }),
          }),
          expect.objectContaining({
            kind: "app-server-request",
            method: "turn/start",
            params: expect.objectContaining({
              input: expect.arrayContaining([
                expect.objectContaining({
                  text: expect.stringContaining("I am typing free text"),
                }),
              ]),
            }),
          }),
          expect.objectContaining({
            kind: "worker-action",
            action: expect.objectContaining({
              action: "click_control",
            }),
          }),
          expect.objectContaining({
            kind: "duplicate-delivery-probe",
            collapsed: true,
          }),
          expect.objectContaining({
            kind: "file-write",
            path: "src/app.txt",
          }),
        ]),
      );
      expect(execution.serializedArtifacts).toContain("I am typing free text");
      expect(execution.serializedArtifacts).toContain("duplicate-delivery-probe");
      expect(execution.serializedArtifacts).toContain("toy app ready");
    } finally {
      await harness.cleanup();
    }
  }, 30_000);

  it("runs a fresh-reply burst variant that collapses two post-restart replies into one recovery path", async () => {
    const harness = await createLiveCodexHarness({
      workerCommand: buildNodeCommand(freshBurstWorkerPath),
      judgeCommand: buildNodeCommand(freshBurstJudgePath),
      requireFreshReplyBurst: true,
    });

    try {
      const execution = await harness.runToyAppScenario();

      expect(execution.worker.exitCode).toBe(0);
      expect(execution.judge.exitCode).toBe(0);
      expect(execution.worker.stderr).toContain("worker-mode: fresh-reply-burst");
      expect(execution.worker.stdout).toContain("fresh reply burst one");
      expect(execution.worker.stdout).toContain('"action":"send_thread_reply"');
      expect(execution.judgeVerdict).toEqual({
        status: "pass",
        reasons: [],
      });
      expect(execution.objectiveChecks.freshReplyBurstAttempted).toBe(true);
      expect(execution.objectiveChecks.freshReplyBurstCollapsed).toBe(true);
      expect(execution.objectiveChecks.freshReplyBurstProbeCount).toBe(1);
      expect(execution.artifactBundle.transcript).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "worker-action",
            action: expect.objectContaining({
              action: "send_thread_reply",
              burst_texts: ["fresh reply burst two"],
            }),
          }),
          expect.objectContaining({
            kind: "fresh-reply-burst-probe",
            collapsed: true,
            texts: ["fresh reply burst one", "fresh reply burst two"],
          }),
          expect.objectContaining({
            kind: "file-write",
            path: "src/app.txt",
          }),
        ]),
      );
      expect(execution.serializedArtifacts).toContain("fresh-reply-burst-probe");
      expect(execution.serializedArtifacts).toContain("fresh reply burst one");
      expect(execution.serializedArtifacts).toContain("fresh reply burst two");
      expect(execution.serializedArtifacts).toContain("toy app ready");
    } finally {
      await harness.cleanup();
    }
  }, 30_000);

  it("rejects a toy app run when the adversarial duplicate probe never happens", async () => {
    const harness = await createLiveCodexHarness({
      workerCommand: buildInlineNodeCommand(NO_DUPLICATE_WORKER_SCRIPT),
      judgeCommand: buildInlineNodeCommand(DUPLICATE_STORM_JUDGE_SCRIPT),
    });

    try {
      const execution = await harness.runToyAppScenario();

      expect(execution.judgeVerdict.status).toBe("fail");
      expect(execution.judgeVerdict.reasons).toContain(
        "Missing repeated duplicate-delivery probe actions.",
      );
      expect(execution.objectiveChecks.duplicateDeliveryAttempted).toBe(false);
      expect(execution.objectiveChecks.duplicateDeliveryCollapsed).toBe(false);
      expect(execution.objectiveChecks.passed).toBe(false);
      expect(execution.artifactBundle.transcript).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "duplicate-delivery-probe" }),
        ]),
      );
    } finally {
      await harness.cleanup();
    }
  }, 30_000);

});

function buildNodeCommand(scriptPath: string): string {
  return `${shellQuote(process.execPath)} ${shellQuote(scriptPath)}`;
}

function buildInlineNodeCommand(script: string): string {
  return `${shellQuote(process.execPath)} --input-type=module -e ${shellQuote(script)}`;
}

const NO_DUPLICATE_WORKER_SCRIPT = `import { readFileSync } from "node:fs"; const input = JSON.parse(readFileSync(0, "utf8")); const action = chooseAction(input); process.stderr.write("worker: scenario=" + input.scenario + " step=" + input.step + " state=" + (input.thread?.state ?? "missing") + "\\n"); process.stdout.write(JSON.stringify(action) + "\\n"); function chooseAction(observation) { if (observation.scenario === "toy-app-normal") { return chooseNormalAction(observation); } return chooseAdversarialAction(observation); } function chooseNormalAction(observation) { if (observation.step === 0) { return { action: "send_top_level_message", text: "Build a tiny toy app" }; } if (observation.step === 1) { const approve = findCurrentControl(observation, "Approve"); if (approve) { return toClickAction(approve); } return { action: "send_thread_reply", text: "Approve" }; } return { action: "finish", reason: "normal variant complete" }; } function chooseAdversarialAction(observation) { if (observation.step === 0) { return { action: "send_top_level_message", text: "Build a tiny toy app" }; } if (observation.step === 1) { return { action: "send_thread_reply", text: "single adversarial reply" }; } return { action: "finish", reason: "adversarial variant complete without duplicate probe" }; } function findCurrentControl(observation, label) { return observation.observation.available_controls.find((control) => control.label === label && control.current === true); } function toClickAction(control) { return { action: "click_control", action_id: control.action_id, value: control.value }; }`;

const DUPLICATE_STORM_WORKER_SCRIPT = `import { readFileSync } from "node:fs"; const input = JSON.parse(readFileSync(0, "utf8")); const action = chooseAction(input); process.stderr.write("worker: scenario=" + input.scenario + " step=" + input.step + " state=" + (input.thread?.state ?? "missing") + "\\n"); process.stdout.write(JSON.stringify(action) + "\\n"); function chooseAction(observation) { if (observation.scenario === "toy-app-normal") { return chooseNormalAction(observation); } return chooseAdversarialAction(observation); } function chooseNormalAction(observation) { if (observation.step === 0) { return { action: "send_top_level_message", text: "Build a tiny toy app" }; } if (observation.step === 1) { const approve = findCurrentControl(observation, "Approve"); if (approve) { return toClickAction(approve); } return { action: "send_thread_reply", text: "Approve" }; } return { action: "finish", reason: "normal variant complete" }; } function chooseAdversarialAction(observation) { if (observation.step === 0) { return { action: "send_top_level_message", text: "Build a tiny toy app" }; } if (observation.step === 1) { return { action: "send_thread_reply", text: "duplicate delivery storm", duplicate: true }; } if (observation.step === 2) { const restart = findCurrentControl(observation, "Interrupt") ?? findCurrentControl(observation, "Restart router"); if (restart) { return toClickAction(restart); } return { action: "send_thread_reply", text: "trigger restart" }; } if (observation.step === 3) { const staleControl = findStaleControlByActionId(observation, "interrupt") ?? findStaleChoiceControl(observation, "Approve") ?? findStaleChoiceControl(observation, "Reject"); if (staleControl) { return toClickAction(staleControl); } return { action: "send_thread_reply", text: "stale control probe" }; } if (observation.step === 4) { return { action: "send_thread_reply", text: "duplicate delivery storm", duplicate: true }; } if (observation.step === 5) { const approve = findCurrentControl(observation, "Approve"); if (approve) { return toClickAction(approve); } return { action: "finish", reason: "adversarial variant complete" }; } return { action: "finish", reason: "adversarial variant complete" }; } function findCurrentControl(observation, label) { return observation.observation.available_controls.find((control) => control.label === label && control.current === true); } function findStaleChoiceControl(observation, label) { return observation.observation.available_controls.find((control) => control.label === label && control.current === false && control.action_id.startsWith("codex_choice:")); } function findStaleControlByActionId(observation, actionId) { return observation.observation.available_controls.find((control) => control.action_id === actionId && control.current === false); } function toClickAction(control) { return { action: "click_control", action_id: control.action_id, value: control.value }; }`;

const DUPLICATE_STORM_JUDGE_SCRIPT = `import { readFileSync } from "node:fs"; const bundle = JSON.parse(readFileSync(0, "utf8")); const reasons = validate(bundle); const verdict = reasons.length === 0 ? { status: "pass", reasons: [] } : { status: "fail", reasons }; process.stderr.write("judge: scenario=" + bundle.scenario + " variant=" + bundle.variant + " passed=" + String(verdict.status === "pass") + "\\n"); process.stdout.write(JSON.stringify(verdict) + "\\n"); function validate(bundle) { const reasons = []; if (bundle.scenario !== "toy-app") { reasons.push("Unexpected scenario: " + String(bundle.scenario)); } if (bundle.variant !== "normal+adversarial-restart") { reasons.push("Unexpected variant: " + String(bundle.variant)); } if (bundle.protocolVersion !== 1) { reasons.push("Unexpected protocolVersion: " + String(bundle.protocolVersion)); } if (!Array.isArray(bundle.transcript) || bundle.transcript.length === 0) { reasons.push("Transcript is empty."); } const transcript = Array.isArray(bundle.transcript) ? bundle.transcript : []; const normalActions = transcript.filter((entry) => entry.kind === "worker-action" && entry.variant === "toy-app-normal"); const duplicateProbes = transcript.filter((entry) => entry.kind === "duplicate-delivery-probe" && entry.variant === "toy-app-adversarial-restart"); const restartProbes = transcript.filter((entry) => entry.kind === "restart-generation" && entry.variant === "toy-app-adversarial-restart"); const staleResponses = transcript.filter((entry) => entry.kind === "slack-action-response" && typeof entry.text === "string" && entry.text.includes("needs a new message")); const files = Array.isArray(bundle.files) ? bundle.files : []; if (normalActions.length === 0) { reasons.push("Missing normal variant worker actions."); } if (duplicateProbes.length !== 2) { reasons.push("Missing repeated duplicate-delivery probe actions."); } if (!duplicateProbes.every((probe) => probe.collapsed === true)) { reasons.push("Missing repeated duplicate-delivery collapse evidence."); } if (staleResponses.length === 0) { reasons.push("Missing stale-control rejection evidence."); } if (restartProbes.length === 0) { reasons.push("Missing restart-before-recovery evidence."); } if (!files.some((file) => file.path === "src/app.txt" && String(file.contents).includes("toy app ready"))) { reasons.push("Missing toy app output file."); } if (!transcript.some((entry) => entry.kind === "worker-observation")) { reasons.push("Missing worker-observation entries."); } if (!transcript.some((entry) => entry.kind === "app-server-request")) { reasons.push("Missing app-server request evidence."); } return reasons; }`;

const SINGLE_DUPLICATE_STORM_WORKER_SCRIPT = String.raw`
  import { readFileSync } from "node:fs";

  try {
    const input = JSON.parse(readFileSync(0, "utf8"));
    const action = chooseAction(input);
    process.stderr.write(
      "worker: scenario=" + input.scenario + " step=" + input.step + " state=" + (input.thread?.state ?? "missing") + "\n",
    );
    process.stdout.write(JSON.stringify(action) + "\n");
  } catch (error) {
    process.stderr.write(
      "worker-error: " + (error instanceof Error ? error.stack ?? error.message : String(error)) + "\n",
    );
    process.exitCode = 1;
  }

  function chooseAction(observation) {
    if (observation.scenario === "toy-app-normal") {
      return chooseNormalAction(observation);
    }

    return chooseSingleDuplicateStormAction(observation);
  }

  function chooseNormalAction(observation) {
    if (observation.step === 0) {
      return {
        action: "send_top_level_message",
        text: "Build a tiny toy app",
      };
    }

    if (observation.step === 1) {
      const approve = findCurrentControl(observation, "Approve");
      if (approve) {
        return toClickAction(approve);
      }

      return {
        action: "send_thread_reply",
        text: "Approve",
      };
    }

    return {
      action: "finish",
      reason: "normal variant complete",
    };
  }

  function chooseSingleDuplicateStormAction(observation) {
    if (observation.step === 0) {
      return {
        action: "send_top_level_message",
        text: "Build a tiny toy app",
      };
    }

    if (observation.step === 1) {
      return {
        action: "send_thread_reply",
        text: "duplicate delivery storm",
        duplicate: true,
      };
    }

    if (observation.step === 2) {
      const restart =
        findCurrentControl(observation, "Interrupt") ??
        findCurrentControl(observation, "Restart router");
      if (restart) {
        return toClickAction(restart);
      }

      return {
        action: "send_thread_reply",
        text: "continue after restart",
      };
    }

    if (observation.step === 3) {
      const staleControl =
        findStaleControlByActionId(observation, "interrupt") ??
        findStaleChoiceControl(observation, "Approve") ??
        findStaleChoiceControl(observation, "Reject");
      if (staleControl) {
        return toClickAction(staleControl);
      }

      return {
        action: "send_thread_reply",
        text: "continue after restart",
      };
    }

    if (observation.step === 4) {
      const approve = findCurrentControl(observation, "Approve");
      if (approve) {
        return toClickAction(approve);
      }

      return {
        action: "finish",
        reason: "single duplicate storm variant complete",
      };
    }

    return {
      action: "finish",
      reason: "single duplicate storm variant complete",
    };
  }

  function findCurrentControl(observation, label) {
    return observation.observation.available_controls.find(
      (control) => control.label === label && control.current === true,
    );
  }

  function findStaleChoiceControl(observation, label) {
    return observation.observation.available_controls.find(
      (control) =>
        control.label === label &&
        control.current === false &&
        control.action_id.startsWith("codex_choice:"),
    );
  }

  function findStaleControlByActionId(observation, actionId) {
    return observation.observation.available_controls.find(
      (control) => control.action_id === actionId && control.current === false,
    );
  }

  function toClickAction(control) {
    return {
      action: "click_control",
      action_id: control.action_id,
      value: control.value,
    };
  }
`;

const CLARIFICATION_JUDGE_SCRIPT = String.raw`
  import { readFileSync } from "node:fs";

  const bundle = JSON.parse(readFileSync(0, "utf8"));
  const reasons = validate(bundle);
  const verdict =
    reasons.length === 0 ? { status: "pass", reasons: [] } : { status: "fail", reasons };

  process.stderr.write(
    "judge: scenario=" + bundle.scenario + " variant=" + bundle.variant + " passed=" + String(verdict.status === "pass") + "\n",
  );
  process.stdout.write(JSON.stringify(verdict) + "\n");

  function validate(bundle) {
    const reasons = [];
    const transcript = Array.isArray(bundle.transcript) ? bundle.transcript : [];
    const duplicateProbes = transcript.filter(
      (entry) =>
        entry.kind === "duplicate-delivery-probe" &&
        entry.variant === "toy-app-adversarial-restart" &&
        entry.collapsed === true,
    );
    const clarificationReply = transcript.some(
      (entry) =>
        entry.kind === "worker-action" &&
        entry.variant === "toy-app-adversarial-restart" &&
        entry.action?.action === "send_thread_reply" &&
        typeof entry.action?.text === "string" &&
        entry.action.text.includes("single file"),
    );

    if (bundle.scenario !== "toy-app") {
      reasons.push("Unexpected scenario: " + String(bundle.scenario));
    }

    if (bundle.variant !== "normal+adversarial-restart") {
      reasons.push("Unexpected variant: " + String(bundle.variant));
    }

    if (bundle.protocolVersion !== 1) {
      reasons.push("Unexpected protocolVersion: " + String(bundle.protocolVersion));
    }

    if (duplicateProbes.length < 1) {
      reasons.push("Missing duplicate-delivery probe action.");
    }

    if (!clarificationReply) {
      reasons.push("Missing clarification detour reply.");
    }
    if (!Array.isArray(bundle.files) || !bundle.files.some((file) => file.path === "src/app.txt")) {
      reasons.push("Missing toy app output file.");
    }

    return reasons;
  }
`;

const FRESH_REPLY_BURST_JUDGE_SCRIPT = String.raw`
  import { readFileSync } from "node:fs";

  const bundle = JSON.parse(readFileSync(0, "utf8"));
  const reasons = validate(bundle);
  const verdict =
    reasons.length === 0 ? { status: "pass", reasons: [] } : { status: "fail", reasons };

  process.stderr.write(
    "judge: scenario=" + bundle.scenario + " variant=" + bundle.variant + " passed=" + String(verdict.status === "pass") + "\n",
  );
  process.stdout.write(JSON.stringify(verdict) + "\n");

  function validate(bundle) {
    const reasons = [];
    const transcript = Array.isArray(bundle.transcript) ? bundle.transcript : [];
    const burstProbes = transcript.filter(
      (entry) =>
        entry.kind === "fresh-reply-burst-probe" &&
        entry.variant === "toy-app-adversarial-restart",
    );
    const burstWorkerActions = transcript.filter(
      (entry) =>
        entry.kind === "worker-action" &&
        entry.variant === "toy-app-adversarial-restart" &&
        entry.action?.action === "send_thread_reply" &&
        Array.isArray(entry.action?.burst_texts),
    );

    if (bundle.scenario !== "toy-app") {
      reasons.push("Unexpected scenario: " + String(bundle.scenario));
    }

    if (bundle.variant !== "normal+adversarial-restart") {
      reasons.push("Unexpected variant: " + String(bundle.variant));
    }

    if (bundle.protocolVersion !== 1) {
      reasons.push("Unexpected protocolVersion: " + String(bundle.protocolVersion));
    }

    if (burstWorkerActions.length !== 1) {
      reasons.push("Missing fresh-reply burst worker action.");
    }

    if (burstProbes.length !== 1) {
      reasons.push("Missing fresh-reply burst probe evidence.");
    }

    if (
      burstProbes[0] &&
      (
        burstProbes[0].texts.length !== 2 ||
        burstProbes[0].collapsed !== true ||
        burstProbes[0].threadStartCountAfter !== burstProbes[0].threadStartCountBefore + 1 ||
        burstProbes[0].turnStartCountAfter !== burstProbes[0].turnStartCountBefore + 1
      )
    ) {
      reasons.push("Fresh-reply burst did not collapse to one effective recovery path.");
    }

    if (bundle.objectiveChecks?.freshReplyBurstAttempted !== true) {
      reasons.push("Objective checks did not record a fresh-reply burst.");
    }

    if (bundle.objectiveChecks?.freshReplyBurstCollapsed !== true) {
      reasons.push("Objective checks did not record a collapsed fresh-reply burst.");
    }

    if (bundle.objectiveChecks?.freshReplyBurstProbeCount !== 1) {
      reasons.push("Objective checks did not record exactly one fresh-reply burst probe.");
    }

    if (!bundle.objectiveChecks?.survivedAdversarialStep) {
      reasons.push("Adversarial step was not survived.");
    }

    if (!Array.isArray(bundle.files) || !bundle.files.some((file) => file.path === "src/app.txt")) {
      reasons.push("Missing toy app output file.");
    }

    if (!transcript.some((entry) => entry.kind === "worker-observation")) {
      reasons.push("Missing worker-observation entries.");
    }

    if (!transcript.some((entry) => entry.kind === "app-server-request")) {
      reasons.push("Missing app-server request evidence.");
    }

    return reasons;
  }
`;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
