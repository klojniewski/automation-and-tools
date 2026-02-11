import { defineConfig } from "@trigger.dev/sdk/v3";
import "dotenv/config";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF!,
  dirs: ["./src/trigger"],
  maxDuration: 300,
  build: {
    external: ["googleapis"],
  },
});
