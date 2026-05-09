export interface ScenarioResult {
  scenarioId: string;
  result: "pass" | "fail";
  durationMs: number;
  sandboxPath?: string;
  mockCallLog?: Array<{ index: number; bytesRead: number }>;
  stubCallLog?: string[];
  failure?: {
    phase: "setup" | "execution" | "assertion" | "cleanup" | "artifact";
    message: string;
    stack?: string;
  };
  harnessVersion: string;
}

const DELIMITER = "===SCENARIO_RESULT===";

export function printResult(result: ScenarioResult): void {
  const summary =
    result.result === "pass"
      ? `\nPASS ${result.scenarioId} (${(result.durationMs / 1000).toFixed(2)}s)`
      : `\nFAIL ${result.scenarioId} (${(result.durationMs / 1000).toFixed(2)}s)${result.sandboxPath ? ` — see ${result.sandboxPath}` : ""}`;
  console.log(summary);
  console.log(DELIMITER);
  console.log(JSON.stringify(result, null, 2));
  console.log(DELIMITER);
}
