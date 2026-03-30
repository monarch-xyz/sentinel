import { Redis } from "ioredis";
import { config } from "../config/index.ts";
import { getErrorMessage } from "../utils/errors.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger("redis");

export const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
});

redis.on("error", (error) => {
  logger.error({ error: getErrorMessage(error) }, "Redis connection error");
});

export async function pingRedis(): Promise<void> {
  const response = await redis.ping();
  if (response !== "PONG") {
    throw new Error(`Unexpected Redis ping response: ${response}`);
  }
}

export async function closeRedis() {
  await redis.quit();
}
