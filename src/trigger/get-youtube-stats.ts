import { schemaTask } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { getYouTubeStats } from "../lib/youtube-stats.js";

export const getYouTubeStatsTask = schemaTask({
  id: "get-youtube-stats",
  schema: z.object({
    week: z.string().optional(),
    dryRun: z.boolean().default(false),
  }),
  machine: "micro",
  maxDuration: 120,
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    return await getYouTubeStats(payload);
  },
});
