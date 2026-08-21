import "server-only";

import {
  summarizeScenarioScenesWithOpenAi as summarizeWithExplicitServerConfig,
  type OpenAiSceneSummaryInput
} from "@/lib/server/openAiSceneSummary";

export { OpenAiSceneSummaryConfigurationError } from "@/lib/server/openAiSceneSummary";

/** Server-only boundary: API credentials are read here and nowhere client-reachable. */
export function summarizeScenarioScenesWithOpenAi(scenes: OpenAiSceneSummaryInput[]) {
  return summarizeWithExplicitServerConfig(scenes, {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_SCENE_SUMMARY_MODEL ?? ""
  });
}
