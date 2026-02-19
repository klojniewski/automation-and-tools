import { z } from "zod";
import "dotenv/config";

const EnvSchema = z.object({
  PIPEDRIVE_API_TOKEN: z.string().min(1, "Pipedrive API token is required"),
  PIPEDRIVE_USER_ID: z.string().min(1, "Pipedrive user ID is required").transform(Number),
  PIPEDRIVE_DOMAIN: z.string().min(1, "Pipedrive company domain is required (e.g. 'mycompany' from mycompany.pipedrive.com)"),
  ANTHROPIC_API_KEY: z.string().min(1, "Anthropic API key is required"),

  // Google service account (GA4 + Sheets)
  GOOGLE_SERVICE_ACCOUNT_KEY: z.string().default(""),

  // Gmail OAuth2 (refresh-token based)
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_GMAIL_REFRESH_TOKEN: z.string().default(""),
  GOOGLE_YOUTUBE_REFRESH_TOKEN: z.string().default(""),

  // Legacy paths — only used by local CLI fallback
  GMAIL_CREDENTIALS_PATH: z.string().default("./credentials.json"),
  GMAIL_TOKEN_PATH: z.string().default("./token.json"),

  // GA4 + Sheets
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
    const missing = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Missing or invalid environment variables: ${missing}`);
  }
  _env = result.data;
  return _env;
}
