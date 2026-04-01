import type { LiveCodexJudgeRubric } from "./live_codex_judge_rubric.js";

export type LiveCodexScenarioVariant =
  | "toy-app-normal"
  | "toy-app-adversarial-restart";

export type LiveCodexControlSnapshot = {
  label: string;
  action_id: string;
  value: string | null;
  current: boolean;
};

export type LiveCodexWorkerObservation = {
  protocol_version: 1;
  scenario: LiveCodexScenarioVariant;
  step: number;
  objective: string;
  rules: {
    max_steps: number;
    must_use_real_router: boolean;
    must_not_emit_fake_artifacts: boolean;
  };
  thread: {
    channel_id: string;
    thread_ts: string | null;
    state: "missing" | "running" | "awaiting_user_input" | "idle" | "interrupted" | "failed_setup";
    app_server_session_stale: boolean;
  };
  observation: {
    posted_messages: Array<{
      thread_ts: string;
      text: string;
      controls: LiveCodexControlSnapshot[];
    }>;
    said_messages: Array<{
      thread_ts: string;
      text: string;
    }>;
    action_responses: Array<{
      text: string;
    }>;
    available_controls: LiveCodexControlSnapshot[];
    request_counts: Record<string, number>;
    artifacts: {
      files: string[];
      git_diff_stat: string;
    };
    recent_events: LiveCodexTranscriptEntry[];
  };
};

export type LiveCodexWorkerAction =
  | { action: "send_top_level_message"; text: string }
  | {
      action: "send_thread_reply";
      text: string;
      duplicate?: boolean;
      burst_texts?: string[];
    }
  | { action: "click_control"; action_id: string; value?: string | null }
  | { action: "finish"; reason?: string };

export type LiveCodexTranscriptEntry =
  | {
      kind: "worker-observation";
      variant: LiveCodexScenarioVariant;
      step: number;
      thread_state: LiveCodexWorkerObservation["thread"]["state"];
      available_controls: LiveCodexControlSnapshot[];
    }
  | {
      kind: "worker-action";
      variant: LiveCodexScenarioVariant;
      step: number;
      action: LiveCodexWorkerAction;
    }
  | {
      kind: "slack-message";
      source: "posted" | "said";
      thread_ts: string;
      text: string;
      controls?: LiveCodexControlSnapshot[];
    }
  | {
      kind: "slack-action-response";
      text: string;
    }
  | {
      kind: "thread-state";
      variant: LiveCodexScenarioVariant;
      thread_ts: string;
      state: string;
      appServerSessionStale: boolean;
      activeTurnId: string | null;
    }
  | {
      kind: "app-server-request";
      method: string;
      params: Record<string, unknown>;
    }
  | {
      kind: "restart-generation";
      variant: LiveCodexScenarioVariant;
      generation: number;
    }
  | {
      kind: "duplicate-delivery-probe";
      variant: LiveCodexScenarioVariant;
      thread_ts: string;
      text: string;
      thread_state: string;
      threadStartCountBefore: number;
      threadStartCountAfter: number;
      turnStartCountBefore: number;
      turnStartCountAfter: number;
      collapsed: boolean;
    }
  | {
      kind: "fresh-reply-burst-probe";
      variant: LiveCodexScenarioVariant;
      thread_ts: string;
      texts: string[];
      threadStartCountBefore: number;
      threadStartCountAfter: number;
      turnStartCountBefore: number;
      turnStartCountAfter: number;
      collapsed: boolean;
    }
  | {
      kind: "file-write";
      path: string;
      contents: string;
    }
  | {
      kind: "git-diff";
      variant: LiveCodexScenarioVariant;
      diff: string;
    };

export type LiveCodexArtifactBundle = {
  scenario: "toy-app";
  variant: "normal+adversarial-restart";
  protocolVersion: 1;
  transcript: LiveCodexTranscriptEntry[];
  files: Array<{ path: string; contents: string }>;
  gitDiff: string;
  finalThread: {
    state: string;
    appServerSessionStale: boolean;
    activeTurnId: string | null;
  } | null;
  objectiveChecks: {
    passed: boolean;
    completedToyApp: boolean;
    usedRealRouter: boolean;
    sawMultiRoundSlackFlow: boolean;
    duplicateDeliveryAttempted: boolean;
    duplicateDeliveryCollapsed: boolean;
    duplicateDeliveryProbeCount: number;
    duplicateDeliveryCollapsedCount: number;
    freshReplyBurstAttempted: boolean;
    freshReplyBurstCollapsed: boolean;
    freshReplyBurstProbeCount: number;
    survivedAdversarialStep: boolean;
  };
  rubric: LiveCodexJudgeRubric;
};

export function buildLiveCodexArtifactBundle(
  input: LiveCodexArtifactBundle,
): LiveCodexArtifactBundle {
  return {
    scenario: input.scenario,
    variant: input.variant,
    protocolVersion: input.protocolVersion,
    transcript: [...input.transcript],
    files: [...input.files],
    gitDiff: input.gitDiff,
    finalThread: input.finalThread ? { ...input.finalThread } : null,
    objectiveChecks: { ...input.objectiveChecks },
    rubric: input.rubric,
  };
}

export function serializeLiveCodexArtifactBundle(
  bundle: LiveCodexArtifactBundle,
): string {
  return JSON.stringify(bundle, null, 2);
}
