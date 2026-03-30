import { closeRedis, redis } from "../redis/client.ts";

// BullMQ requires an IORedis instance, so the worker reuses the shared Redis client.
export const connection = redis;

export const closeConnection = async () => {
  await closeRedis();
};
