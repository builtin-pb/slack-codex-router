import {
  dirname,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFile, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  buildLiveCodexArtifactBundle,
  serializeLiveCodexArtifactBundle,
  type LiveCodexTranscriptEntry,
} from "./live_codex_artifacts.js";
import { LIVE_CODEX_TOY_APP_RUBRIC } from "./live_codex_judge_rubric.js";

const execFileAsync = promisify(execFile);

type RecordedFile = {
  path: string;
  contents: string;
};

export function isLiveCodexEnabled(): boolean {
  return (
    process.env.LIVE_CODEX_E2E === "1" &&
    hasText(process.env.LIVE_CODEX_WORKER_CMD) &&
    hasText(process.env.LIVE_CODEX_JUDGE_CMD)
  );
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
    judgeVerdict: { status: "pass" | "fail"; reasons: string[] };
    artifactBundle: ReturnType<typeof buildLiveCodexArtifactBundle>;
    serializedArtifacts: string;
    worker: { stdout: string; stderr: string; exitCode: number | null };
    judge: { stdout: string; stderr: string; exitCode: number | null };
  }>;
  cleanup(): Promise<void>;
}> {
  const workspaceDir = mkdtempSync(join(tmpdir(), "router-live-codex-"));
  const transcript: LiveCodexTranscriptEntry[] = [];
  const files: RecordedFile[] = [];
  let gitDiff = "";
  let gitRepoReady = false;

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
        throw new Error(
          "LIVE_CODEX_E2E=1, LIVE_CODEX_WORKER_CMD, and LIVE_CODEX_JUDGE_CMD are required to run the live lane.",
        );
      }

      await ensureGitRepoReady(workspaceDir, gitRepoReady);
      gitRepoReady = true;

      const worker = await runCommand(process.env.LIVE_CODEX_WORKER_CMD!, {
        cwd: workspaceDir,
        stdin: JSON.stringify({
          prompt: readFileSync(
            new URL("../fixtures/live_codex_worker_prompt.md", import.meta.url),
            "utf8",
          ),
          workspaceDir,
          rubric: LIVE_CODEX_TOY_APP_RUBRIC,
        }),
      });

      for (const line of worker.stdout.split("\n").filter(Boolean)) {
        const event = JSON.parse(line) as
          | LiveCodexTranscriptEntry
          | { kind: "file-write"; path: string; contents: string };

        if (event.kind === "slack-message" || event.kind === "app-server-request" || event.kind === "git-diff") {
          transcript.push(event);
          continue;
        }

        if (event.kind === "file-write") {
          const absolutePath = join(workspaceDir, event.path);
          const actualContents = readFileSync(absolutePath, "utf8");
          files.push({ path: event.path, contents: actualContents });
          transcript.push({
            kind: "file-write",
            path: event.path,
            contents: actualContents,
          });
          continue;
        }

        throw new Error(`Unsupported live worker event: ${JSON.stringify(event)}`);
      }

      gitDiff = await readGitDiff(workspaceDir);
      transcript.push({
        kind: "git-diff",
        diff: gitDiff,
      });

      const artifactBundle = buildLiveCodexArtifactBundle({
        transcript,
        files,
        gitDiff,
        rubric: LIVE_CODEX_TOY_APP_RUBRIC,
      });

      const judge = await runCommand(process.env.LIVE_CODEX_JUDGE_CMD!, {
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

      return {
        objectiveChecks: {
          passed: artifactBundle.files.some((file) => file.path === "src/app.txt"),
        },
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
  writeFileSync(join(workspaceDir, "README.md"), "# live codex workspace\n", "utf8");
  await execFileAsync("git", ["add", "README.md"], { cwd: workspaceDir });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: workspaceDir });
}

async function readGitDiff(workspaceDir: string): Promise<string> {
  const result = await execFileAsync("git", ["diff", "--stat", "HEAD"], { cwd: workspaceDir });
  return result.stdout.trim();
}

async function runCommand(
  command: string,
  options: { cwd: string; stdin: string },
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
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
