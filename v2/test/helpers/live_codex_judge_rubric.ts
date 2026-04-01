export type LiveCodexJudgeCriterion = {
  id: string;
  description: string;
};

export type LiveCodexJudgeRubric = {
  scenario: "toy-app";
  criteria: LiveCodexJudgeCriterion[];
};

export const LIVE_CODEX_TOY_APP_RUBRIC: LiveCodexJudgeRubric = {
  scenario: "toy-app",
  criteria: [
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
  ],
};
