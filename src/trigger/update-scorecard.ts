import { schemaTask } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { updateScorecard } from "../lib/scorecard.js";

export const updateScorecardTask = schemaTask({
  id: "update-scorecard",
  schema: z.object({
    week: z.string().optional(),
    pipeline: z.number().default(22),
    dryRun: z.boolean().default(false),
  }),
  machine: "micro",
  maxDuration: 120,
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    return await updateScorecard(payload);
  },
});
