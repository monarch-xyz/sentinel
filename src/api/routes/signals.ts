import express from "express";
import {
  NotificationLogRepository,
  SignalRepository,
  SignalRunLogRepository,
} from "../../db/index.ts";
import { compileSignalDefinition } from "../../engine/compile-signal.ts";
import {
  SourceCapabilityError,
  assertSignalDefinitionSourcesEnabled,
} from "../../engine/source-capabilities.ts";
import { DeliveryIntegrationError } from "../../integrations/delivery.ts";
import { getErrorMessage, isZodError } from "../../utils/errors.ts";
import { createLogger } from "../../utils/logger.ts";
import { ValidationError } from "../../utils/validation.ts";
import { inferManagedSignalDelivery, resolveSignalWebhookUrl } from "../signal-delivery.ts";
import {
  assertStoredDefinitionSourcesEnabled,
  formatSourceCapabilityError,
} from "../source-guard.ts";
import { CreateSignalSchema, UpdateSignalSchema } from "../validators.ts";

const logger = createLogger("api:signals");
const router: express.Router = express.Router();
const repo = new SignalRepository();
const notificationLogRepo = new NotificationLogRepository();
const signalRunLogRepo = new SignalRunLogRepository();

function parseDefinition(definition: unknown): unknown {
  if (typeof definition !== "string") return definition;
  try {
    return JSON.parse(definition);
  } catch {
    return definition;
  }
}

interface SignalRow {
  id: string;
  name: string;
  definition: unknown;
  [key: string]: unknown;
}

function formatSignalForResponse(signal: SignalRow) {
  const rawDefinition = parseDefinition(signal.definition);
  const definition =
    rawDefinition &&
    typeof rawDefinition === "object" &&
    "dsl" in (rawDefinition as Record<string, unknown>)
      ? (rawDefinition as Record<string, unknown>).dsl
      : rawDefinition;

  return {
    ...signal,
    definition,
    delivery: inferManagedSignalDelivery(signal.webhook_url),
  };
}

// Create Signal
router.post("/", async (req, res) => {
  try {
    if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized" });
    const validated = CreateSignalSchema.parse(req.body);
    const webhookUrl = await resolveSignalWebhookUrl(validated, req.auth.userId);
    const compiled = compileSignalDefinition(validated.definition);
    assertSignalDefinitionSourcesEnabled(compiled.dsl);
    const signal = await repo.create({
      user_id: req.auth.userId,
      name: validated.name,
      description: validated.description,
      definition: compiled,
      webhook_url: webhookUrl,
      cooldown_minutes: validated.cooldown_minutes,
    });
    res.status(201).json(formatSignalForResponse(signal));
  } catch (error: unknown) {
    if (isZodError(error)) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message, field: error.field });
    }
    if (error instanceof SourceCapabilityError) {
      return res.status(409).json(formatSourceCapabilityError(error));
    }
    if (error instanceof DeliveryIntegrationError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    logger.error({ error: getErrorMessage(error) }, "Failed to create signal");
    res.status(500).json({ error: "Internal server error" });
  }
});

// List Signals
router.get("/", async (req, res) => {
  try {
    if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized" });
    const activeOnly = req.query.active === "true";
    const signals = await repo.list(req.auth.userId, activeOnly);
    res.json(signals.map(formatSignalForResponse));
  } catch (_error: unknown) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get Signal
router.get("/:id", async (req, res) => {
  try {
    if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized" });
    const signal = await repo.getById(req.auth.userId, req.params.id);
    if (!signal) return res.status(404).json({ error: "Signal not found" });
    res.json(formatSignalForResponse(signal));
  } catch (_error: unknown) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Signal evaluation and notification history
router.get("/:id/history", async (req, res) => {
  try {
    if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized" });

    const signal = await repo.getById(req.auth.userId, req.params.id);
    if (!signal) return res.status(404).json({ error: "Signal not found" });

    const rawLimit = Number.parseInt(String(req.query.limit ?? "100"), 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100;
    const includeNotifications = req.query.include_notifications !== "false";

    const [evaluations, notifications] = await Promise.all([
      signalRunLogRepo.getBySignalId(signal.id, limit),
      includeNotifications
        ? notificationLogRepo.getBySignalId(signal.id, limit)
        : Promise.resolve([]),
    ]);

    res.json({
      signal_id: signal.id,
      evaluations,
      notifications,
      count: {
        evaluations: evaluations.length,
        notifications: notifications.length,
      },
    });
  } catch (error: unknown) {
    logger.error({ error: getErrorMessage(error) }, "Failed to fetch signal history");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete Signal
router.delete("/:id", async (req, res) => {
  try {
    if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized" });
    const result = await repo.delete(req.auth.userId, req.params.id);
    res.json(result);
  } catch (_error: unknown) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update Signal (partial)
router.patch("/:id", async (req, res) => {
  try {
    if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized" });
    const validated = UpdateSignalSchema.parse(req.body);
    const existing = await repo.getById(req.auth.userId, req.params.id);
    if (!existing) return res.status(404).json({ error: "Signal not found" });

    const nextWebhookUrl =
      validated.delivery || validated.webhook_url
        ? await resolveSignalWebhookUrl(validated, req.auth.userId)
        : undefined;

    const payload = {
      ...(validated.name !== undefined ? { name: validated.name } : {}),
      ...(validated.description !== undefined ? { description: validated.description } : {}),
      ...(validated.cooldown_minutes !== undefined
        ? { cooldown_minutes: validated.cooldown_minutes }
        : {}),
      ...(validated.is_active !== undefined ? { is_active: validated.is_active } : {}),
      ...(nextWebhookUrl !== undefined ? { webhook_url: nextWebhookUrl } : {}),
      ...(validated.definition
        ? {
            definition: (() => {
              const compiled = compileSignalDefinition(validated.definition);
              assertSignalDefinitionSourcesEnabled(compiled.dsl);
              return compiled;
            })(),
          }
        : {}),
    };

    if (validated.is_active === true) {
      assertStoredDefinitionSourcesEnabled(payload.definition ?? existing.definition);
    }

    const signal = await repo.update(req.auth.userId, req.params.id, payload);
    if (!signal) return res.status(404).json({ error: "Signal not found" });
    res.json(formatSignalForResponse(signal));
  } catch (error: unknown) {
    if (isZodError(error)) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message, field: error.field });
    }
    if (error instanceof SourceCapabilityError) {
      return res.status(409).json(formatSourceCapabilityError(error));
    }
    if (error instanceof DeliveryIntegrationError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    logger.error({ error: getErrorMessage(error) }, "Failed to update signal");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Toggle Signal Active Status
router.patch("/:id/toggle", async (req, res) => {
  try {
    if (!req.auth?.userId) return res.status(401).json({ error: "Unauthorized" });
    const existing = await repo.getById(req.auth.userId, req.params.id);
    if (!existing) return res.status(404).json({ error: "Signal not found" });

    if (!existing.is_active) {
      assertStoredDefinitionSourcesEnabled(existing.definition);
    }

    const signal = await repo.update(req.auth.userId, req.params.id, {
      is_active: !existing.is_active,
    });
    res.json(formatSignalForResponse(signal));
  } catch (error: unknown) {
    if (error instanceof SourceCapabilityError) {
      return res.status(409).json(formatSourceCapabilityError(error));
    }
    logger.error({ error: getErrorMessage(error) }, "Failed to toggle signal");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
