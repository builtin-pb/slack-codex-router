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
      id: "multi-round-flow",
      description: "The transcript shows a coherent multi-round worker interaction.",
    },
    {
      id: "app-files",
      description: "The final workspace contains the requested toy app files.",
    },
    {
      id: "artifact-bound",
      description: "The verdict is based only on the captured evidence bundle.",
    },
  ],
};
