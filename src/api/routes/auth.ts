import express from "express";
import { z } from "zod";
import { ApiKeyRepository, UserRepository } from "../../db/index.js";
import { getErrorMessage, isZodError } from "../../utils/errors.js";
import { createLogger } from "../../utils/logger.js";
import { generateApiKey, hashApiKey } from "../middleware/auth.js";

const logger = createLogger("api:auth");
const router: express.Router = express.Router();
const users = new UserRepository();
const keys = new ApiKeyRepository();

const RegisterSchema = z.object({
  name: z.string().min(1).optional(),
  key_name: z.string().min(1).optional(),
});

router.post("/register", async (req, res) => {
  try {
    const { name, key_name } = RegisterSchema.parse(req.body ?? {});

    const user = await users.create(name ?? null);
    const apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);
    const keyRecord = await keys.create(user.id, keyHash, key_name ?? null);

    res.status(201).json({
      user_id: user.id,
      api_key_id: keyRecord.id,
      api_key: apiKey,
    });
  } catch (error: unknown) {
    if (isZodError(error)) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }
    logger.error({ error: getErrorMessage(error) }, "Registration failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
