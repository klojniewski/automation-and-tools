import { schemaTask } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { analyzeDealPipeline } from "../lib/deal-analysis.js";

export const analyzeDealsTask = schemaTask({
  id: "analyze-deals",
  schema: z.object({
    limit: z.number().default(50),
    emailDays: z.number().default(90),
    maxEmails: z.number().default(10),
  }),
  machine: "small-1x",
  maxDuration: 300,
  retry: { maxAttempts: 1 },
  run: async (payload) => {
    return await analyzeDealPipeline(payload);
  },
});
