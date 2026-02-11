import { schemaTask } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { getPipedriveDeals } from "../lib/pipedrive-stats.js";

export const getPipedriveDealsTask = schemaTask({
  id: "get-pipedrive-deals",
  schema: z.object({
    week: z.string().optional(),
    pipeline: z.number().default(22),
    dryRun: z.boolean().default(false),
  }),
  machine: "micro",
  maxDuration: 120,
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    return await getPipedriveDeals(payload);
  },
});
