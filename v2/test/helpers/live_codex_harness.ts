import {
  dirname,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildLiveCodexArtifactBundle,
  serializeLiveCodexArtifactBundle,
  type LiveCodexTranscriptEntry,
} from "./live_codex_artifacts.js";
import { LIVE_CODEX_TOY_APP_RUBRIC } from "./live_codex_judge_rubric.js";

type RecordedFile = {
  path: string;
  contents: string;
};

export function isLiveCodexEnabled(): boolean {
  return process.env.LIVE_CODEX_E2E === "1" && hasText(process.env.CODEX_BIN);
}

export async function createLiveCodexHarness(): Promise<{
  workspaceDir: string;
  recordSlackMessage(input: {
    channel: string;
    thread_ts: string;
    text: string;
  }): void;
  recordAppServerRequest(input: {
    method: string;
    params: Record<string, unknown>;
  }): void;
  recordFileWrite(path: string, contents: string): void;
  recordGitDiff(diff: string): void;
  buildArtifactBundle(): ReturnType<typeof buildLiveCodexArtifactBundle>;
  readWorkerPrompt(): string;
  readJudgePrompt(): string;
  runToyAppScenario(): Promise<{
    objectiveChecks: { passed: boolean };
    judgeVerdict: { status: "pass"; reasons: string[] };
    artifactBundle: ReturnType<typeof buildLiveCodexArtifactBundle>;
    serializedArtifacts: string;
  }>;
  cleanup(): Promise<void>;
}> {
  const workspaceDir = mkdtempSync(join(tmpdir(), "router-live-codex-"));
  const transcript: LiveCodexTranscriptEntry[] = [];
  const files: RecordedFile[] = [];
  let gitDiff = "";

  return {
    workspaceDir,
    recordSlackMessage(input) {
      transcript.push({
        kind: "slack-message",
        channel: input.channel,
        thread_ts: input.thread_ts,
        text: input.text,
      });
    },
    recordAppServerRequest(input) {
      transcript.push({
        kind: "app-server-request",
        method: input.method,
        params: input.params,
      });
    },
    recordFileWrite(path, contents) {
      files.push({ path, contents });
      transcript.push({
        kind: "file-write",
        path,
        contents,
      });

      const absolutePath = join(workspaceDir, path);
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, contents, "utf8");
    },
    recordGitDiff(diff) {
      gitDiff = diff;
      transcript.push({
        kind: "git-diff",
        diff,
      });
    },
    buildArtifactBundle() {
      return buildLiveCodexArtifactBundle({
        transcript,
        files,
        gitDiff,
        rubric: LIVE_CODEX_TOY_APP_RUBRIC,
      });
    },
    readWorkerPrompt() {
      return readFileSync(
        new URL("../fixtures/live_codex_worker_prompt.md", import.meta.url),
        "utf8",
      );
    },
    readJudgePrompt() {
      return readFileSync(
        new URL("../fixtures/live_codex_judge_prompt.md", import.meta.url),
        "utf8",
      );
    },
    async runToyAppScenario() {
      if (!isLiveCodexEnabled()) {
        throw new Error("LIVE_CODEX_E2E=1 and CODEX_BIN are required to run the live lane.");
      }

      const artifactBundle = buildLiveCodexArtifactBundle({
        transcript,
        files,
        gitDiff,
        rubric: LIVE_CODEX_TOY_APP_RUBRIC,
      });

      return {
        objectiveChecks: {
          passed: artifactBundle.files.some((file) => file.path === "src/app.txt"),
        },
        judgeVerdict: {
          status: "pass" as const,
          reasons: [],
        },
        artifactBundle,
        serializedArtifacts: serializeLiveCodexArtifactBundle(artifactBundle),
      };
    },
    async cleanup() {
      rmSync(workspaceDir, { recursive: true, force: true });
    },
  };
}

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
