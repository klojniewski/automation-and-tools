import { schedules } from "@trigger.dev/sdk/v3";
import { updateScorecard } from "../lib/scorecard.js";

/**
 * Weekly scheduled scorecard update — Tuesdays 10:00 Europe/Warsaw (DST-aware).
 * Runs updateScorecard for the last completed week (Mon–Sun), same as the
 * on-demand `update-scorecard` task with no payload. Tuesday (not Monday) so
 * GA4/GSC/YouTube have finished counting the weekend.
 */
export const weeklyScorecardTask = schedules.task({
  id: "weekly-scorecard",
  cron: {
    pattern: "0 10 * * 2",
    timezone: "Europe/Warsaw",
  },
  machine: "micro",
  maxDuration: 120,
  retry: { maxAttempts: 2 },
  run: async () => {
    return await updateScorecard({});
  },
});
