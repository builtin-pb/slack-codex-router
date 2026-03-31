import type { LiveCodexJudgeRubric } from "./live_codex_judge_rubric.js";

export type LiveCodexTranscriptEntry =
  | {
      kind: "slack-message";
      channel: string;
      thread_ts: string;
      text: string;
    }
  | {
      kind: "app-server-request";
      method: string;
      params: Record<string, unknown>;
    }
  | {
      kind: "file-write";
      path: string;
      contents: string;
    }
  | {
      kind: "git-diff";
      diff: string;
    };

export type LiveCodexArtifactBundle = {
  transcript: LiveCodexTranscriptEntry[];
  files: Array<{ path: string; contents: string }>;
  gitDiff: string;
  rubric: LiveCodexJudgeRubric;
};

export function buildLiveCodexArtifactBundle(input: LiveCodexArtifactBundle): LiveCodexArtifactBundle {
  return {
    transcript: [...input.transcript],
    files: [...input.files],
    gitDiff: input.gitDiff,
    rubric: input.rubric,
  };
}

export function serializeLiveCodexArtifactBundle(
  bundle: LiveCodexArtifactBundle,
): string {
  return JSON.stringify(bundle, null, 2);
}
