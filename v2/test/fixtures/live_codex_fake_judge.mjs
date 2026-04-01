import { readFileSync } from "node:fs";

const bundle = JSON.parse(readFileSync(0, "utf8"));
const reasons = validate(bundle);
const verdict = reasons.length === 0 ? { status: "pass", reasons: [] } : { status: "fail", reasons };

process.stderr.write(
  `judge: scenario=${bundle.scenario} variant=${bundle.variant} passed=${String(
    verdict.status === "pass",
  )}\n`,
);
process.stdout.write(`${JSON.stringify(verdict)}\n`);

function validate(bundle) {
  const reasons = [];

  if (bundle.scenario !== "toy-app") {
    reasons.push(`Unexpected scenario: ${String(bundle.scenario)}`);
  }

  if (bundle.variant !== "normal+adversarial-restart") {
    reasons.push(`Unexpected variant: ${String(bundle.variant)}`);
  }

  if (bundle.protocolVersion !== 1) {
    reasons.push(`Unexpected protocolVersion: ${String(bundle.protocolVersion)}`);
  }

  if (!Array.isArray(bundle.transcript) || bundle.transcript.length === 0) {
    reasons.push("Transcript is empty.");
  }

  const transcript = Array.isArray(bundle.transcript) ? bundle.transcript : [];
  const normalActions = transcript.filter(
    (entry) => entry.kind === "worker-action" && entry.variant === "toy-app-normal",
  );
  const adversarialActions = transcript.filter(
    (entry) => entry.kind === "worker-action" && entry.variant === "toy-app-adversarial-restart",
  );
  const duplicateProbeActions = adversarialActions.filter(
    (entry) => entry.action?.action === "send_thread_reply" && entry.action?.duplicate === true,
  );
  const duplicateProbeEvidence = transcript.filter(
    (entry) => entry.kind === "duplicate-delivery-probe" && entry.variant === "toy-app-adversarial-restart",
  );
  const freshBurstActions = adversarialActions.filter(
    (entry) =>
      entry.action?.action === "send_thread_reply" && Array.isArray(entry.action?.burst_texts),
  );
  const freshBurstEvidence = transcript.filter(
    (entry) => entry.kind === "fresh-reply-burst-probe" && entry.variant === "toy-app-adversarial-restart",
  );
  const restartProbes = transcript.filter(
    (entry) => entry.kind === "restart-generation" && entry.variant === "toy-app-adversarial-restart",
  );
  const staleResponses = transcript.filter(
    (entry) =>
      entry.kind === "slack-action-response" &&
      typeof entry.text === "string" &&
      entry.text.includes("needs a new message"),
  );
  const files = Array.isArray(bundle.files) ? bundle.files : [];

  if (normalActions.length === 0) {
    reasons.push("Missing normal variant worker actions.");
  }

  const expectsFreshBurst =
    freshBurstActions.length > 0 ||
    freshBurstEvidence.length > 0 ||
    bundle.objectiveChecks?.freshReplyBurstAttempted === true;

  if (expectsFreshBurst) {
    if (freshBurstActions.length !== 1) {
      reasons.push(`Expected 1 fresh-reply burst action, got ${freshBurstActions.length}.`);
    }

    if (freshBurstEvidence.length !== 1) {
      reasons.push(`Expected 1 fresh-reply burst probe, got ${freshBurstEvidence.length}.`);
    }

    if (freshBurstEvidence.some((entry) => entry.collapsed !== true)) {
      reasons.push("Fresh-reply burst probe did not collapse.");
    }

    if (bundle.objectiveChecks?.freshReplyBurstAttempted !== true) {
      reasons.push("Objective checks did not record a fresh-reply burst.");
    }

    if (bundle.objectiveChecks?.freshReplyBurstCollapsed !== true) {
      reasons.push("Objective checks did not record a collapsed fresh-reply burst.");
    }

    if (bundle.objectiveChecks?.freshReplyBurstProbeCount !== 1) {
      reasons.push(
        `Objective checks recorded ${String(bundle.objectiveChecks?.freshReplyBurstProbeCount)} fresh-reply burst probes instead of 1.`,
      );
    }
  } else {
    if (duplicateProbeActions.length !== 2) {
      reasons.push(`Expected 2 duplicate-delivery probe actions, got ${duplicateProbeActions.length}.`);
    }

    if (duplicateProbeActions.some((entry) => entry.action?.duplicate !== true)) {
      reasons.push("Missing duplicate-delivery collapse marker.");
    }

    if (duplicateProbeEvidence.length !== 2) {
      reasons.push(`Expected 2 duplicate-delivery probe evidence entries, got ${duplicateProbeEvidence.length}.`);
    }

    if (duplicateProbeEvidence.some((entry) => entry.collapsed !== true)) {
      reasons.push("Duplicate-delivery probe evidence was not fully collapsed.");
    }

    const restartIndex = transcript.findIndex(
      (entry) => entry.kind === "restart-generation" && entry.variant === "toy-app-adversarial-restart",
    );
    const probeIndexes = transcript.reduce((indexes, entry, index) => {
      if (entry.kind === "duplicate-delivery-probe" && entry.variant === "toy-app-adversarial-restart") {
        indexes.push(index);
      }
      return indexes;
    }, []);
    if (
      restartIndex === -1 ||
      probeIndexes.length !== 2 ||
      !(probeIndexes[0] < restartIndex && probeIndexes[1] > restartIndex)
    ) {
      reasons.push("Duplicate-delivery probes did not bracket the restart path.");
    }

    if (staleResponses.length === 0) {
      reasons.push("Missing stale-control rejection evidence.");
    }

    if (restartProbes.length === 0) {
      reasons.push("Missing restart-before-recovery evidence.");
    }

    if (bundle.objectiveChecks?.duplicateDeliveryAttempted !== true) {
      reasons.push("Objective checks did not record duplicate delivery.");
    }

    if (bundle.objectiveChecks?.duplicateDeliveryCollapsed !== true) {
      reasons.push("Objective checks did not record duplicate collapse.");
    }

    if (bundle.objectiveChecks?.duplicateDeliveryProbeCount !== 2) {
      reasons.push(
        `Objective checks recorded ${String(bundle.objectiveChecks?.duplicateDeliveryProbeCount)} duplicate probes instead of 2.`,
      );
    }

    if (bundle.objectiveChecks?.duplicateDeliveryCollapsedCount !== 2) {
      reasons.push(
        `Objective checks recorded ${String(bundle.objectiveChecks?.duplicateDeliveryCollapsedCount)} collapsed duplicate probes instead of 2.`,
      );
    }
  }

  if (!files.some((file) => file.path === "src/app.txt" && String(file.contents).includes("toy app ready"))) {
    reasons.push("Missing toy app output file.");
  }

  if (!bundle.objectiveChecks || bundle.objectiveChecks.passed !== true) {
    reasons.push("Objective checks did not pass.");
  }

  if (!bundle.objectiveChecks?.survivedAdversarialStep) {
    reasons.push("Adversarial step was not survived.");
  }

  if (!bundle.gitDiff || typeof bundle.gitDiff !== "string") {
    reasons.push("Missing git diff evidence.");
  }

  if (!transcript.some((entry) => entry.kind === "worker-observation")) {
    reasons.push("Missing worker-observation entries.");
  }

  if (!transcript.some((entry) => entry.kind === "app-server-request")) {
    reasons.push("Missing app-server request evidence.");
  }

  return reasons;
}
