import express from "express";
import { z } from "zod";
import {
  DeliveryIntegrationError,
  getTelegramIntegrationStatus,
  linkTelegramIntegration,
} from "../../integrations/delivery.ts";
import { getErrorMessage, isZodError } from "../../utils/errors.ts";
import { createLogger } from "../../utils/logger.ts";

const logger = createLogger("api:me");
const router: express.Router = express.Router();

const TelegramLinkSchema = z.object({
  token: z.string().min(1),
});

router.get("/integrations/telegram", async (req, res) => {
  try {
    if (!req.auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const status = await getTelegramIntegrationStatus(req.auth.userId);
    return res.json(status);
  } catch (error: unknown) {
    if (error instanceof DeliveryIntegrationError) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    logger.error({ error: getErrorMessage(error) }, "Failed to fetch Telegram integration");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/integrations/telegram/link", async (req, res) => {
  try {
    if (!req.auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { token } = TelegramLinkSchema.parse(req.body ?? {});
    const status = await linkTelegramIntegration(req.auth.userId, token);
    return res.json(status);
  } catch (error: unknown) {
    if (isZodError(error)) {
      return res.status(400).json({ error: "Invalid request", details: error.errors });
    }

    if (error instanceof DeliveryIntegrationError) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    logger.error({ error: getErrorMessage(error) }, "Failed to link Telegram integration");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
