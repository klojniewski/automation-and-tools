import { z } from "zod";
import "dotenv/config";

const EnvSchema = z.object({
  PIPEDRIVE_API_TOKEN: z.string().min(1, "Pipedrive API token is required"),
  PIPEDRIVE_USER_ID: z.string().min(1, "Pipedrive user ID is required").transform(Number),
  PIPEDRIVE_DOMAIN: z.string().min(1, "Pipedrive company domain is required (e.g. 'mycompany' from mycompany.pipedrive.com)"),
  ANTHROPIC_API_KEY: z.string().min(1, "Anthropic API key is required"),
  GMAIL_CREDENTIALS_PATH: z.string().default("./credentials.json"),
  GMAIL_TOKEN_PATH: z.string().default("./token.json"),

  // GA4 + Sheets (optional — only needed for `marketing` commands)
  GA4_PROPERTY_ID: z.string().default(""),
  GOOGLE_SHEETS_ID: z.string().default(""),
  GOOGLE_SHEETS_TAB: z.string().default("Sheet1"),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;

  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Missing or invalid environment variables:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    console.error("\nSee .env.example for required configuration.");
    process.exit(1);
  }
  _env = result.data;
  return _env;
}
