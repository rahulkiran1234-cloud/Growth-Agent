// Client-safe (no server imports): shared by the orchestrator and the UI.
export const STEP_NAMES = [
  "Analyse current state",
  "Retrieve competitor evidence",
  "Compare against competitors",
  "Identify problems",
  "Solutions and ROI",
  "30-day action plan",
] as const;
