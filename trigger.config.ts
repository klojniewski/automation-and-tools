import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "proj_placeholder", // Replace with your Trigger.dev project ref
  dirs: ["./src/trigger"],
  maxDuration: 300,
  build: {
    external: ["googleapis"],
  },
});
