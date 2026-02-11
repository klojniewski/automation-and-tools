import { schemaTask } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { getGA4Stats } from "../lib/ga4-stats.js";

export const getGA4StatsTask = schemaTask({
  id: "get-ga4-stats",
  schema: z.object({
    week: z.string().optional(),
    dryRun: z.boolean().default(false),
  }),
  machine: "micro",
  maxDuration: 120,
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    return await getGA4Stats(payload);
  },
});
