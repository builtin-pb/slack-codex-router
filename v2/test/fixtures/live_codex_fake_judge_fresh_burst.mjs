import { readFileSync } from "node:fs";

const bundle = JSON.parse(readFileSync(0, "utf8"));
const reasons = validate(bundle);
const verdict =
  reasons.length === 0 ? { status: "pass", reasons: [] } : { status: "fail", reasons };

process.stderr.write(
  `judge: scenario=${bundle.scenario} variant=${bundle.variant} passed=${String(
    verdict.status === "pass",
  )}\n`,
);
process.stdout.write(`${JSON.stringify(verdict)}\n`);

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
    reasons.push(`Unexpected scenario: ${String(bundle.scenario)}`);
  }

  if (bundle.variant !== "normal+adversarial-restart") {
    reasons.push(`Unexpected variant: ${String(bundle.variant)}`);
  }

  if (bundle.protocolVersion !== 1) {
    reasons.push(`Unexpected protocolVersion: ${String(bundle.protocolVersion)}`);
  }

  if (burstWorkerActions.length !== 1) {
    reasons.push("Missing fresh-reply burst worker action.");
  }

  if (burstProbes.length !== 1) {
    reasons.push("Missing fresh-reply burst probe evidence.");
  }

  if (
    burstProbes[0] &&
    (burstProbes[0].texts.length !== 2 ||
      burstProbes[0].collapsed !== true ||
      burstProbes[0].threadStartCountAfter !== burstProbes[0].threadStartCountBefore + 1 ||
      burstProbes[0].turnStartCountAfter !== burstProbes[0].turnStartCountBefore + 1)
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
