import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { RESTART_EXIT_CODE } from "../../src/runtime/restart.js";
import {
  buildLiveCodexArtifactBundle,
  serializeLiveCodexArtifactBundle,
  type LiveCodexArtifactBundle,
  type LiveCodexControlSnapshot,
  type LiveCodexScenarioVariant,
  type LiveCodexTranscriptEntry,
  type LiveCodexWorkerAction,
  type LiveCodexWorkerObservation,
} from "./live_codex_artifacts.js";
import { LIVE_CODEX_TOY_APP_RUBRIC } from "./live_codex_judge_rubric.js";
import { createRealAppServerHarness } from "./real_app_server_harness.js";

const execFileAsync = promisify(execFile);
const LIVE_CODEX_CHANNEL = "C08TEMPLATE";
const LIVE_CODEX_USER = "U123";

type LiveCodexHarnessOptions = {
  workerCommand?: string;
  judgeCommand?: string;
  requireFreshReplyBurst?: boolean;
};

type RecordedFile = {
  path: string;
  contents: string;
};

type RecordedPostedMessage = {
  thread_ts: string;
  text: string;
  controls: LiveCodexControlSnapshot[];
  generation: number;
};

type RecordedSaidMessage = {
  thread_ts: string;
  text: string;
  generation: number;
};

type WorkerCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

type VariantExecution = {
  transcript: LiveCodexTranscriptEntry[];
  files: RecordedFile[];
  gitDiff: string;
  finalThread: LiveCodexArtifactBundle["finalThread"];
  objectiveChecks: LiveCodexArtifactBundle["objectiveChecks"];
  worker: WorkerCommandResult;
};

type VariantState = {
  variant: LiveCodexScenarioVariant;
  step: number;
  nextTs: number;
  threadTs: string | null;
  generation: number;
  staleControlRejected: boolean;
  restartObserved: boolean;
  latestThreadStateKey: string | null;
  lastPostedIndex: number;
  lastSaidIndex: number;
  lastActionResponseIndex: number;
  lastRequestIndex: number;
  lastArtifactIndex: number;
  lastExitIndex: number;
  postedMessages: RecordedPostedMessage[];
  saidMessages: RecordedSaidMessage[];
  duplicateDeliveryProbes: Array<{
    text: string;
    threadState: string;
    turnStartCountBefore: number;
    turnStartCountAfter: number;
    collapsed: boolean;
  }>;
  freshReplyBurstProbes: Array<{
    texts: string[];
    threadStartCountBefore: number;
    threadStartCountAfter: number;
    turnStartCountBefore: number;
    turnStartCountAfter: number;
    collapsed: boolean;
  }>;
  workerStdout: string[];
  workerStderr: string[];
  transcript: LiveCodexTranscriptEntry[];
  files: RecordedFile[];
};

export function isLiveCodexEnabled(): boolean {
  return (
    process.env.LIVE_CODEX_E2E === "1" &&
    hasText(process.env.LIVE_CODEX_WORKER_CMD) &&
    hasText(process.env.LIVE_CODEX_JUDGE_CMD)
  );
}

export async function createLiveCodexHarness(
  options: LiveCodexHarnessOptions = {},
): Promise<{
  workspaceDir: string;
  readWorkerPrompt(): string;
  readJudgePrompt(): string;
  runToyAppScenario(): Promise<{
    objectiveChecks: LiveCodexArtifactBundle["objectiveChecks"];
    judgeVerdict: { status: "pass" | "fail"; reasons: string[] };
    artifactBundle: LiveCodexArtifactBundle;
    serializedArtifacts: string;
    worker: WorkerCommandResult;
    judge: WorkerCommandResult;
  }>;
  cleanup(): Promise<void>;
}> {
  const workspaceDir = mkdtempSync(join(tmpdir(), "router-live-codex-"));
  let gitRepoReady = false;

  return {
    workspaceDir,
    readWorkerPrompt() {
      return readPrompt("live_codex_worker_prompt.md");
    },
    readJudgePrompt() {
      return readPrompt("live_codex_judge_prompt.md");
    },
    async runToyAppScenario() {
      const workerCommand = options.workerCommand ?? process.env.LIVE_CODEX_WORKER_CMD;
      const judgeCommand = options.judgeCommand ?? process.env.LIVE_CODEX_JUDGE_CMD;
      const requireFreshReplyBurst =
        options.requireFreshReplyBurst ?? process.env.LIVE_CODEX_VARIANT === "fresh-burst";
      const usingOverrides = hasText(options.workerCommand) || hasText(options.judgeCommand);

      if (usingOverrides) {
        if (!hasText(options.workerCommand) || !hasText(options.judgeCommand)) {
          throw new Error("Worker and judge command overrides must be provided together.");
        }
      } else if (!isLiveCodexEnabled()) {
        throw new Error(
          "LIVE_CODEX_E2E=1, LIVE_CODEX_WORKER_CMD, and LIVE_CODEX_JUDGE_CMD are required to run the live lane.",
        );
      }

      if (!hasText(workerCommand) || !hasText(judgeCommand)) {
        throw new Error("Live codex worker and judge commands must be provided.");
      }

      await ensureGitRepoReady(workspaceDir, gitRepoReady);
      gitRepoReady = true;

      const normal = await runVariant({
        workspaceDir,
        workerCommand,
        variant: "toy-app-normal",
        objective: "Build a tiny toy app through the router as the Slack user.",
        initialPrompt: "Build a tiny toy app",
        requireFreshReplyBurst,
      });
      const adversarial = await runVariant({
        workspaceDir,
        workerCommand,
        variant: "toy-app-adversarial-restart",
        objective:
          "Build a tiny toy app through the router as the Slack user, then probe stale-control and restart recovery safely.",
        initialPrompt: "Build a tiny toy app",
        requireFreshReplyBurst,
      });

      const combinedTranscript = [...normal.transcript, ...adversarial.transcript];
      const combinedFiles = dedupeFiles([...normal.files, ...adversarial.files]);
      const combinedGitDiff = [normal.gitDiff, adversarial.gitDiff].filter(Boolean).join("\n\n");
      const objectiveChecks = {
        passed:
          normal.objectiveChecks.completedToyApp &&
          adversarial.objectiveChecks.completedToyApp &&
          adversarial.objectiveChecks.survivedAdversarialStep,
        completedToyApp:
          normal.objectiveChecks.completedToyApp &&
          adversarial.objectiveChecks.completedToyApp,
        usedRealRouter:
          normal.objectiveChecks.usedRealRouter || adversarial.objectiveChecks.usedRealRouter,
        sawMultiRoundSlackFlow:
          normal.objectiveChecks.sawMultiRoundSlackFlow &&
          adversarial.objectiveChecks.sawMultiRoundSlackFlow,
        duplicateDeliveryAttempted: adversarial.objectiveChecks.duplicateDeliveryAttempted,
        duplicateDeliveryCollapsed: adversarial.objectiveChecks.duplicateDeliveryCollapsed,
        duplicateDeliveryProbeCount: adversarial.objectiveChecks.duplicateDeliveryProbeCount,
        duplicateDeliveryCollapsedCount:
          adversarial.objectiveChecks.duplicateDeliveryCollapsedCount,
        freshReplyBurstAttempted: adversarial.objectiveChecks.freshReplyBurstAttempted,
        freshReplyBurstCollapsed: adversarial.objectiveChecks.freshReplyBurstCollapsed,
        freshReplyBurstProbeCount: adversarial.objectiveChecks.freshReplyBurstProbeCount,
        survivedAdversarialStep: adversarial.objectiveChecks.survivedAdversarialStep,
      };

      const artifactBundle = buildLiveCodexArtifactBundle({
        scenario: "toy-app",
        variant: "normal+adversarial-restart",
        protocolVersion: 1,
        transcript: combinedTranscript,
        files: combinedFiles,
        gitDiff: combinedGitDiff,
        finalThread: adversarial.finalThread,
        objectiveChecks,
        rubric: LIVE_CODEX_TOY_APP_RUBRIC,
      });

      const judge = await runCommand(judgeCommand, {
        cwd: workspaceDir,
        stdin: JSON.stringify(artifactBundle),
      });

      if (!judge.stdout.trim()) {
        throw new Error(
          [
            "Judge command produced no JSON stdout.",
            `exitCode=${String(judge.exitCode)}`,
            `stderr=${judge.stderr.trim() || "<empty>"}`,
          ].join(" "),
        );
      }

      const judgeVerdict = JSON.parse(judge.stdout.trim()) as {
        status: "pass" | "fail";
        reasons: string[];
      };
      const worker = combineWorkerResults(normal.worker, adversarial.worker);

      return {
        objectiveChecks,
        judgeVerdict,
        artifactBundle,
        serializedArtifacts: serializeLiveCodexArtifactBundle(artifactBundle),
        worker,
        judge,
      };
    },
    async cleanup() {
      rmSync(workspaceDir, { recursive: true, force: true });
    },
  };
}

async function runVariant(input: {
  workspaceDir: string;
  workerCommand: string;
  variant: LiveCodexScenarioVariant;
  objective: string;
  initialPrompt: string;
  requireFreshReplyBurst: boolean;
}): Promise<VariantExecution> {
  const harness = await createRealAppServerHarness({
    scenario: "toy-app-build",
    persistentStore: true,
    useRealGitRepo: true,
  });
  const state: VariantState = {
    variant: input.variant,
    step: 0,
    nextTs: input.variant === "toy-app-normal" ? 10100 : 20100,
    threadTs: null,
    generation: 1,
    staleControlRejected: false,
    restartObserved: false,
    latestThreadStateKey: null,
    lastPostedIndex: 0,
    lastSaidIndex: 0,
    lastActionResponseIndex: 0,
    lastRequestIndex: 0,
    lastArtifactIndex: 0,
    lastExitIndex: 0,
    postedMessages: [],
    saidMessages: [],
    duplicateDeliveryProbes: [],
    freshReplyBurstProbes: [],
    workerStdout: [],
    workerStderr: [],
    transcript: [],
    files: [],
  };

  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await collectEvidence(harness, state);
      const gitDiff = await readVariantGitDiff(harness, state.threadTs);
      const observation = buildObservation({
        harness,
        state,
        objective: input.objective,
        gitDiff,
      });
      state.transcript.push({
        kind: "worker-observation",
        variant: state.variant,
        step: state.step,
        thread_state: observation.thread.state,
        available_controls: observation.observation.available_controls,
      });

      const worker = await runCommand(input.workerCommand, {
        cwd: input.workspaceDir,
        stdin: JSON.stringify(observation),
      });
      state.workerStdout.push(worker.stdout);
      state.workerStderr.push(worker.stderr);
      if (worker.exitCode !== 0) {
        throw new Error(
          [
            `Worker command failed with exit code ${String(worker.exitCode)}.`,
            `stderr=${worker.stderr.trim() || "<empty>"}`,
            `stdout=${worker.stdout.trim() || "<empty>"}`,
          ].join(" "),
        );
      }

      const action = parseWorkerAction(worker.stdout);
      state.transcript.push({
        kind: "worker-action",
        variant: state.variant,
        step: state.step,
        action,
      });

      if (action.action === "finish") {
        break;
      }

      await executeWorkerAction(harness, state, action, input.initialPrompt, observation);
      await collectEvidence(harness, state);
      if (await maybeRestartGeneration(harness, state)) {
        await collectEvidence(harness, state);
      }

      state.step += 1;
      if (variantSatisfied(harness, state, input.requireFreshReplyBurst)) {
        break;
      }
    }

    await collectEvidence(harness, state);
    const gitDiff = await readVariantGitDiff(harness, state.threadTs);
    state.transcript.push({
      kind: "git-diff",
      variant: state.variant,
      diff: gitDiff,
    });

    const finalThread =
      state.threadTs ? harness.store.getThread(LIVE_CODEX_CHANNEL, state.threadTs) : null;
    return {
      transcript: state.transcript,
      files: state.files,
      gitDiff,
      finalThread: finalThread
        ? {
            state: finalThread.state,
            appServerSessionStale: Boolean(finalThread.appServerSessionStale),
            activeTurnId: finalThread.activeTurnId ?? null,
          }
        : null,
      objectiveChecks: {
        passed: variantSatisfied(harness, state, input.requireFreshReplyBurst),
        completedToyApp: completedToyApp(harness, state),
        usedRealRouter: harness.readRequests().some((request) => request.method === "turn/start"),
        sawMultiRoundSlackFlow: sawMultiRoundSlackFlow(state),
        duplicateDeliveryAttempted: state.duplicateDeliveryProbes.length > 0,
        duplicateDeliveryCollapsed:
          state.duplicateDeliveryProbes.length > 0 &&
          state.duplicateDeliveryProbes.every((probe) => probe.collapsed),
        duplicateDeliveryProbeCount: state.duplicateDeliveryProbes.length,
        duplicateDeliveryCollapsedCount: state.duplicateDeliveryProbes.filter(
          (probe) => probe.collapsed,
        ).length,
        freshReplyBurstAttempted: state.freshReplyBurstProbes.length > 0,
        freshReplyBurstCollapsed:
          state.freshReplyBurstProbes.length > 0 &&
          state.freshReplyBurstProbes.every((probe) => probe.collapsed),
        freshReplyBurstProbeCount: state.freshReplyBurstProbes.length,
        survivedAdversarialStep:
          state.variant === "toy-app-normal"
            ? true
            : input.requireFreshReplyBurst
              ? state.restartObserved &&
                state.freshReplyBurstProbes.length >= 1 &&
                state.freshReplyBurstProbes.every((probe) => probe.collapsed) &&
                completedToyApp(harness, state)
              : state.staleControlRejected &&
                state.restartObserved &&
                state.duplicateDeliveryProbes.length >= 2 &&
                state.duplicateDeliveryProbes.every((probe) => probe.collapsed) &&
                completedToyApp(harness, state),
      },
      worker: {
        stdout: state.workerStdout.join("\n"),
        stderr: state.workerStderr.join("\n"),
        exitCode: 0,
      },
    };
  } finally {
    await harness.cleanup();
  }
}

function buildObservation(input: {
  harness: Awaited<ReturnType<typeof createRealAppServerHarness>>;
  state: VariantState;
  objective: string;
  gitDiff: string;
}): LiveCodexWorkerObservation {
  const thread = input.state.threadTs
    ? input.harness.store.getThread(LIVE_CODEX_CHANNEL, input.state.threadTs)
    : null;
  const postedMessages = input.state.postedMessages.filter(
    (message) => message.thread_ts === input.state.threadTs,
  );
  const saidMessages = input.state.saidMessages.filter(
    (message) => message.thread_ts === input.state.threadTs,
  );
  const availableControls = collectAvailableControls(postedMessages, input.state.generation);
  const requestCounts = countRequests(input.harness.readRequests());
  const files = dedupeFiles(input.state.files).map((file) => file.path);

  return {
    protocol_version: 1,
    scenario: input.state.variant,
    step: input.state.step,
    objective: input.objective,
    rules: {
      max_steps: 20,
      must_use_real_router: true,
      must_not_emit_fake_artifacts: true,
    },
    thread: {
      channel_id: LIVE_CODEX_CHANNEL,
      thread_ts: input.state.threadTs,
      state: thread ? normalizeThreadState(thread.state) : "missing",
      app_server_session_stale: thread?.appServerSessionStale ?? false,
    },
    observation: {
      posted_messages: postedMessages,
      said_messages: saidMessages,
      action_responses: input.harness.actionResponses.map((response) => ({
        text: typeof response.text === "string" ? response.text : "",
      })),
      available_controls: availableControls,
      request_counts: requestCounts,
      artifacts: {
        files,
        git_diff_stat: input.gitDiff,
      },
      recent_events: input.state.transcript.slice(-10),
    },
  };
}

async function executeWorkerAction(
  harness: Awaited<ReturnType<typeof createRealAppServerHarness>>,
  state: VariantState,
  action: LiveCodexWorkerAction,
  initialPrompt: string,
  observation: LiveCodexWorkerObservation,
): Promise<void> {
  switch (action.action) {
    case "send_top_level_message": {
      if (state.threadTs) {
        throw new Error("Top-level message is only valid before a thread exists.");
      }

      const ts = nextSlackTs(state);
      state.threadTs = ts;
      await harness.dispatchTopLevelMessage({
        user: LIVE_CODEX_USER,
        channel: LIVE_CODEX_CHANNEL,
        ts,
        text: action.text.trim() || initialPrompt,
      });
      return;
    }
    case "send_thread_reply": {
      if (!state.threadTs) {
        throw new Error("Thread reply requires an active thread.");
      }

      const burstTexts = Array.isArray(action.burst_texts)
        ? action.burst_texts.map((text) => (typeof text === "string" ? text.trim() : "")).filter(Boolean)
        : [];

      if (action.duplicate === true && burstTexts.length > 0) {
        throw new Error("send_thread_reply cannot request duplicate and burst delivery at once.");
      }

      if (burstTexts.length > 0) {
        const threadStartCountBefore = countRequests(harness.readRequests())["thread/start"] ?? 0;
        const turnStartCountBefore = countRequests(harness.readRequests())["turn/start"] ?? 0;
        const replyTexts = [action.text, ...burstTexts]
          .map((text) => (typeof text === "string" ? text.trim() : ""))
          .filter((text) => text.length > 0);

        if (replyTexts.length < 2) {
          throw new Error("Thread reply burst requires at least two distinct reply texts.");
        }

        if (new Set(replyTexts).size !== replyTexts.length) {
          throw new Error("Thread reply burst requires distinct reply texts.");
        }

        await dispatchThreadReplyBurst(harness, state, replyTexts);
        await waitForRequestCount(harness, "thread/start", threadStartCountBefore + 1);
        await waitForRequestCount(harness, "turn/start", turnStartCountBefore + 1);
        await delay(100);
        const turnStartCountAfter = countRequests(harness.readRequests())["turn/start"] ?? 0;
        const threadStartCountAfter = countRequests(harness.readRequests())["thread/start"] ?? 0;
        const collapsed =
          turnStartCountAfter === turnStartCountBefore + 1 &&
          threadStartCountAfter === threadStartCountBefore + 1;
        const probe = {
          texts: replyTexts,
          threadStartCountBefore,
          threadStartCountAfter,
          turnStartCountBefore,
          turnStartCountAfter,
          collapsed,
        };
        state.freshReplyBurstProbes.push(probe);
        state.transcript.push({
          kind: "fresh-reply-burst-probe",
          variant: state.variant,
          thread_ts: String(state.threadTs),
          texts: probe.texts,
          threadStartCountBefore: probe.threadStartCountBefore,
          threadStartCountAfter: probe.threadStartCountAfter,
          turnStartCountBefore: probe.turnStartCountBefore,
          turnStartCountAfter: probe.turnStartCountAfter,
          collapsed: probe.collapsed,
        });
        return;
      }

      const turnStartCountBefore = observation.observation.request_counts["turn/start"] ?? 0;
      const threadStartCountBefore = observation.observation.request_counts["thread/start"] ?? 0;
      const expectFreshRebind = observation.thread.app_server_session_stale;

      if (action.duplicate === true) {
        await harness.dispatchThreadReply({
          user: LIVE_CODEX_USER,
          channel: LIVE_CODEX_CHANNEL,
          ts: nextSlackTs(state),
          thread_ts: state.threadTs,
          text: action.text,
        });
        await harness.dispatchThreadReply({
          user: LIVE_CODEX_USER,
          channel: LIVE_CODEX_CHANNEL,
          ts: nextSlackTs(state),
          thread_ts: state.threadTs,
          text: action.text,
        });
        if (expectFreshRebind) {
          await waitForRequestCount(harness, "thread/start", threadStartCountBefore + 1);
        }
        await waitForRequestCount(harness, "turn/start", turnStartCountBefore + 1);
        const turnStartCountAfter = countRequests(harness.readRequests())["turn/start"] ?? 0;
        const threadStartCountAfter = countRequests(harness.readRequests())["thread/start"] ?? 0;
        const collapsed =
          threadStartCountAfter ===
            (expectFreshRebind ? threadStartCountBefore + 1 : threadStartCountBefore) &&
          turnStartCountAfter === turnStartCountBefore + 1;
        const probe = {
          text: action.text,
          threadState: observation.thread.state,
          threadStartCountBefore,
          threadStartCountAfter,
          turnStartCountBefore,
          turnStartCountAfter,
          collapsed,
        };
        state.duplicateDeliveryProbes.push(probe);
        state.transcript.push({
          kind: "duplicate-delivery-probe",
          variant: state.variant,
          thread_ts: String(state.threadTs),
          text: probe.text,
          thread_state: probe.threadState,
          threadStartCountBefore: probe.threadStartCountBefore,
          threadStartCountAfter: probe.threadStartCountAfter,
          turnStartCountBefore: probe.turnStartCountBefore,
          turnStartCountAfter: probe.turnStartCountAfter,
          collapsed: probe.collapsed,
        });
        return;
      }

      await harness.dispatchThreadReply({
        user: LIVE_CODEX_USER,
        channel: LIVE_CODEX_CHANNEL,
        ts: nextSlackTs(state),
        thread_ts: state.threadTs,
        text: action.text,
      });
      if (expectFreshRebind) {
        await waitForRequestCount(harness, "thread/start", threadStartCountBefore + 1);
      }
      await waitForRequestCount(harness, "turn/start", turnStartCountBefore + 1);
      return;
    }
    case "click_control": {
      if (!state.threadTs) {
        throw new Error("Control clicks require an active thread.");
      }

      const control = observation.observation.available_controls.find(
        (entry) =>
          entry.action_id === action.action_id &&
          (entry.value ?? null) === (action.value ?? null),
      );
      if (!control) {
        throw new Error(`Worker clicked an unknown control: ${action.action_id}`);
      }

      await harness.dispatchAction(action.action_id, {
        action: {
          action_id: action.action_id,
          ...(action.value !== undefined ? { value: action.value } : {}),
        },
        user: { id: LIVE_CODEX_USER },
        channel: { id: LIVE_CODEX_CHANNEL },
        message: { thread_ts: state.threadTs },
      });
      return;
    }
    case "finish":
      return;
  }
}

async function maybeRestartGeneration(
  harness: Awaited<ReturnType<typeof createRealAppServerHarness>>,
  state: VariantState,
): Promise<boolean> {
  const exits = harness.processExitCodes.slice(state.lastExitIndex);
  state.lastExitIndex = harness.processExitCodes.length;
  if (!exits.includes(RESTART_EXIT_CODE)) {
    return false;
  }

  await harness.bootNextGeneration();
  state.generation += 1;
  state.restartObserved = true;
  state.lastPostedIndex = 0;
  state.lastSaidIndex = 0;
  state.transcript.push({
    kind: "restart-generation",
    variant: state.variant,
    generation: state.generation,
  });
  return true;
}

async function collectEvidence(
  harness: Awaited<ReturnType<typeof createRealAppServerHarness>>,
  state: VariantState,
): Promise<void> {
  if (state.lastPostedIndex > harness.slack.postedMessages.length) {
    state.lastPostedIndex = 0;
  }
  for (const message of harness.slack.postedMessages.slice(state.lastPostedIndex)) {
    const recordedMessage: RecordedPostedMessage = {
      thread_ts: String(message.thread_ts ?? ""),
      text: typeof message.text === "string" ? message.text : "",
      controls: extractControlsFromMessage(message, true),
      generation: state.generation,
    };
    state.postedMessages.push(recordedMessage);
    state.transcript.push({
      kind: "slack-message",
      source: "posted",
      thread_ts: recordedMessage.thread_ts,
      text: recordedMessage.text,
      controls: recordedMessage.controls,
    });
  }
  state.lastPostedIndex = harness.slack.postedMessages.length;

  if (state.lastSaidIndex > harness.slack.saidMessages.length) {
    state.lastSaidIndex = 0;
  }
  for (const message of harness.slack.saidMessages.slice(state.lastSaidIndex)) {
    const recordedMessage: RecordedSaidMessage = {
      thread_ts: String(message.thread_ts ?? ""),
      text: typeof message.text === "string" ? message.text : "",
      generation: state.generation,
    };
    state.saidMessages.push(recordedMessage);
    state.transcript.push({
      kind: "slack-message",
      source: "said",
      thread_ts: recordedMessage.thread_ts,
      text: recordedMessage.text,
    });
  }
  state.lastSaidIndex = harness.slack.saidMessages.length;

  for (const response of harness.actionResponses.slice(state.lastActionResponseIndex)) {
    const text = typeof response.text === "string" ? response.text : "";
    if (text.includes("needs a new message")) {
      state.staleControlRejected = true;
    }
    state.transcript.push({
      kind: "slack-action-response",
      text,
    });
  }
  state.lastActionResponseIndex = harness.actionResponses.length;

  const requests = harness.readRequests();
  for (const request of requests.slice(state.lastRequestIndex)) {
    state.transcript.push({
      kind: "app-server-request",
      method: typeof request.method === "string" ? request.method : "<unknown>",
      params:
        request.params && typeof request.params === "object"
          ? (request.params as Record<string, unknown>)
          : {},
    });
  }
  state.lastRequestIndex = requests.length;

  const artifacts = harness.readArtifacts();
  for (const artifact of artifacts.slice(state.lastArtifactIndex)) {
    if (artifact.kind !== "file-write" || typeof artifact.path !== "string") {
      continue;
    }

    const contents = readArtifactFileContents(artifact);
    state.files.push({ path: artifact.path, contents });
    state.transcript.push({
      kind: "file-write",
      path: artifact.path,
      contents,
    });
  }
  state.lastArtifactIndex = artifacts.length;

  if (!state.threadTs) {
    return;
  }

  const thread = harness.store.getThread(LIVE_CODEX_CHANNEL, state.threadTs);
  if (!thread) {
    return;
  }

  const nextKey = [
    thread.state,
    thread.appServerSessionStale ? "stale" : "live",
    thread.activeTurnId ?? "",
  ].join("\u0000");
  if (nextKey === state.latestThreadStateKey) {
    return;
  }

  state.latestThreadStateKey = nextKey;
  state.transcript.push({
    kind: "thread-state",
    variant: state.variant,
    thread_ts: state.threadTs,
    state: thread.state,
    appServerSessionStale: Boolean(thread.appServerSessionStale),
    activeTurnId: thread.activeTurnId ?? null,
  });
}

function completedToyApp(
  harness: Awaited<ReturnType<typeof createRealAppServerHarness>>,
  state: VariantState,
): boolean {
  if (!state.threadTs) {
    return false;
  }

  const thread = harness.store.getThread(LIVE_CODEX_CHANNEL, state.threadTs);
  return (
    thread?.state === "idle" &&
    state.files.some((file) => file.path === "src/app.txt" && file.contents.includes("toy app ready"))
  );
}

function sawMultiRoundSlackFlow(state: VariantState): boolean {
  const userActions = state.transcript.filter((entry) => entry.kind === "worker-action").length;
  const slackMessages = state.transcript.filter((entry) => entry.kind === "slack-message").length;
  return userActions >= 2 && slackMessages >= 2;
}

function variantSatisfied(
  harness: Awaited<ReturnType<typeof createRealAppServerHarness>>,
  state: VariantState,
  requireFreshReplyBurst: boolean,
): boolean {
  if (!completedToyApp(harness, state)) {
    return false;
  }

  if (state.variant === "toy-app-normal") {
    return true;
  }

  if (requireFreshReplyBurst) {
    return (
      state.restartObserved &&
      state.freshReplyBurstProbes.length >= 1 &&
      state.freshReplyBurstProbes.every((probe) => probe.collapsed)
    );
  }

  return (
    state.duplicateDeliveryProbes.length >= 2 &&
    state.duplicateDeliveryProbes.every((probe) => probe.collapsed) &&
    state.staleControlRejected &&
    state.restartObserved
  );
}

function normalizeThreadState(
  state: string,
): LiveCodexWorkerObservation["thread"]["state"] {
  switch (state) {
    case "running":
    case "awaiting_user_input":
    case "idle":
    case "interrupted":
    case "failed_setup":
      return state;
    default:
      return "missing";
  }
}

function collectAvailableControls(
  messages: Array<RecordedPostedMessage>,
  currentGeneration: number,
): LiveCodexControlSnapshot[] {
  const latestControls =
    [...messages].reverse().find((message) => message.generation === currentGeneration)?.controls ?? [];
  const latestKeys = new Set(latestControls.map((control) => controlKey(control.action_id, control.value)));
  const seen = new Map<string, LiveCodexControlSnapshot>();

  for (const message of messages) {
    for (const control of message.controls) {
      seen.set(controlKey(control.action_id, control.value), {
        ...control,
        current: latestKeys.has(controlKey(control.action_id, control.value)),
      });
    }
  }

  return [...seen.values()];
}

function extractControlsFromMessage(
  message: Record<string, unknown>,
  current: boolean,
): LiveCodexControlSnapshot[] {
  const blocks = Array.isArray(message.blocks) ? message.blocks : [];
  const controls: LiveCodexControlSnapshot[] = [];

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
      if (typeof actionId !== "string") {
        continue;
      }

      const label = (element as { text?: { text?: unknown } }).text?.text;
      controls.push({
        label: typeof label === "string" ? label : actionId,
        action_id: actionId,
        value:
          typeof (element as { value?: unknown }).value === "string"
            ? ((element as { value: string }).value ?? null)
            : null,
        current,
      });
    }
  }

  return controls;
}

function readArtifactFileContents(artifact: Record<string, unknown>): string {
  const cwd = typeof artifact.cwd === "string" ? artifact.cwd : "";
  const path = typeof artifact.path === "string" ? artifact.path : "";
  if (!cwd || !path) {
    return typeof artifact.contents === "string" ? artifact.contents : "";
  }

  return readFileSync(join(cwd, path), "utf8");
}

function dedupeFiles(files: RecordedFile[]): RecordedFile[] {
  const map = new Map<string, RecordedFile>();
  for (const file of files) {
    map.set(file.path, file);
  }

  return [...map.values()];
}

function countRequests(requests: Array<Record<string, unknown>>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const request of requests) {
    if (typeof request.method !== "string") {
      continue;
    }

    counts[request.method] = (counts[request.method] ?? 0) + 1;
  }

  return counts;
}

function countRunningTurnReplies(messages: Array<Record<string, unknown>>): number {
  return messages.filter((message) => {
    const text = typeof message.text === "string" ? message.text : "";
    return text === "This Slack thread already has a running Codex turn.";
  }).length;
}

async function dispatchThreadReplyBurst(
  harness: Awaited<ReturnType<typeof createRealAppServerHarness>>,
  state: VariantState,
  texts: string[],
): Promise<void> {
  if (!state.threadTs) {
    throw new Error("Thread reply burst requires an active thread.");
  }

  if (texts.length === 0) {
    throw new Error("Thread reply burst requires at least one reply text.");
  }

  for (const text of texts) {
    await harness.dispatchThreadReply({
      user: LIVE_CODEX_USER,
      channel: LIVE_CODEX_CHANNEL,
      ts: nextSlackTs(state),
      thread_ts: state.threadTs,
      text,
    });
  }
}

async function readVariantGitDiff(
  harness: Awaited<ReturnType<typeof createRealAppServerHarness>>,
  threadTs: string | null,
): Promise<string> {
  const thread = threadTs ? harness.store.getThread(LIVE_CODEX_CHANNEL, threadTs) : null;
  const cwd = thread?.worktreePath ?? harness.projectDir;
  const [diffResult, statusResult] = await Promise.all([
    execFileAsync("git", ["diff", "--stat", "HEAD"], { cwd }),
    execFileAsync("git", ["status", "--short", "--untracked-files=all"], { cwd }),
  ]);

  return [diffResult.stdout.trim(), statusResult.stdout.trim()].filter(Boolean).join("\n");
}

function parseWorkerAction(stdout: string): LiveCodexWorkerAction {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== 1) {
    throw new Error(`Worker must emit exactly one JSON action, received ${lines.length}.`);
  }

  return JSON.parse(lines[0]) as LiveCodexWorkerAction;
}

function combineWorkerResults(
  ...results: WorkerCommandResult[]
): WorkerCommandResult {
  const exitCode = results.find((result) => result.exitCode !== 0)?.exitCode ?? 0;
  return {
    stdout: results.map((result) => result.stdout).filter(Boolean).join("\n"),
    stderr: results.map((result) => result.stderr).filter(Boolean).join("\n"),
    exitCode,
  };
}

function nextSlackTs(state: VariantState): string {
  const seconds = Math.floor(state.nextTs / 100);
  const fraction = String(state.nextTs % 100).padStart(4, "0");
  state.nextTs += 1;
  return `1710000000.${String(seconds).padStart(4, "0")}${fraction.slice(2)}`;
}

function controlKey(actionId: string, value: string | null): string {
  return `${actionId}\u0000${value ?? ""}`;
}

function readPrompt(filename: string): string {
  return readFileSync(new URL(`../fixtures/${filename}`, import.meta.url), "utf8");
}

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

async function ensureGitRepoReady(workspaceDir: string, alreadyReady: boolean): Promise<void> {
  if (alreadyReady) {
    return;
  }

  await execFileAsync("git", ["init"], { cwd: workspaceDir });
  await execFileAsync("git", ["config", "user.name", "Live Codex Tests"], { cwd: workspaceDir });
  await execFileAsync("git", ["config", "user.email", "live-codex@example.com"], {
    cwd: workspaceDir,
  });
  await execFileAsync("sh", ["-lc", "printf '# live codex workspace\\n' > README.md"], {
    cwd: workspaceDir,
  });
  await execFileAsync("git", ["add", "README.md"], { cwd: workspaceDir });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: workspaceDir });
}

async function runCommand(
  command: string,
  options: { cwd: string; stdin: string },
): Promise<WorkerCommandResult> {
  const child = spawn("/bin/sh", ["-lc", command], {
    cwd: options.cwd,
    env: {
      ...process.env,
      LIVE_CODEX_WORKSPACE_DIR: options.cwd,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  child.stdin.end(options.stdin);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });

  return { stdout, stderr, exitCode };
}

async function waitForRequestCount(
  harness: Awaited<ReturnType<typeof createRealAppServerHarness>>,
  method: string,
  minimumCount: number,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const currentCount = countRequests(harness.readRequests())[method] ?? 0;
    if (currentCount >= minimumCount) {
      return;
    }

    await delay(10);
  }

  throw new Error(`Timed out waiting for ${method} request count ${minimumCount}.`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
