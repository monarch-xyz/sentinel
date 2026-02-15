import { z } from "zod";
import "dotenv/config";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Telegram Bot
  TELEGRAM_BOT_TOKEN: z.string().min(1),

  // API Server
  PORT: z.coerce.number().default(3100),
  HOST: z.string().default("0.0.0.0"),

  // Security
  WEBHOOK_SECRET: z
    .string()
    .min(32)
    .describe("Shared secret with Sentinel for webhook auth"),
  LINK_BASE_URL: z.string().url().default("https://sentinel.monarchlend.xyz"),

  // Optional
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Invalid environment variables:");
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
export type Env = z.infer<typeof envSchema>;
