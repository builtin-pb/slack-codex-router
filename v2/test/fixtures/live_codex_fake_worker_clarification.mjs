import { readFileSync } from "node:fs";

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const action = chooseAction(input);
  process.stderr.write("worker-mode: clarification-detour\n");
  process.stderr.write(
    `worker: scenario=${input.scenario} step=${input.step} state=${input.thread?.state ?? "missing"}\n`,
  );
  process.stdout.write(`${JSON.stringify(action)}\n`);
} catch (error) {
  process.stderr.write(
    `worker-error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}

function chooseAction(observation) {
  if (observation.scenario === "toy-app-normal") {
    return chooseNormalAction(observation);
  }

  return chooseClarificationDetourAction(observation);
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

function chooseClarificationDetourAction(observation) {
  if (observation.step === 0) {
    return {
      action: "send_top_level_message",
      text: "Build a tiny toy app",
    };
  }

  if (observation.step === 1) {
    return {
      action: "send_thread_reply",
      text: "Before I approve, can we keep the toy app in a single file?",
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
      text: "trigger restart",
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
      text: "stale control probe",
    };
  }

  if (observation.step === 4) {
    return {
      action: "send_thread_reply",
      text: "duplicate delivery storm",
      duplicate: true,
    };
  }

  if (observation.step === 5) {
    return {
      action: "send_thread_reply",
      text: "Please keep it to a single file if possible.",
    };
  }

  if (observation.step === 6) {
    const approve = findCurrentControl(observation, "Approve");
    if (approve) {
      return toClickAction(approve);
    }

    return {
      action: "finish",
      reason: "clarification detour complete",
    };
  }

  return {
    action: "finish",
    reason: "clarification detour complete",
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
