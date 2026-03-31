import { z } from "zod";
import { validateRawEventSpec } from "../raw-events/catalog.js";
import { RAW_EVENT_KINDS, RAW_EVENT_SWAP_PROTOCOLS } from "../types/raw-events.js";

const SignalScopeSchema = z.object({
  chains: z.array(z.number().int().positive()).min(1),
  markets: z.array(z.string()).optional(),
  addresses: z.array(z.string()).optional(),
  protocol: z.enum(["morpho", "all"]).optional(),
});

const TimeWindowSchema = z.object({
  duration: z.string(),
});

const ComparisonOperatorSchema = z.enum([">", "<", ">=", "<=", "==", "!="]);
const FilterSchema = z.object({
  field: z.string(),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains"]),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
});

const ThresholdConditionSchema = z.object({
  type: z.literal("threshold"),
  metric: z.string(),
  operator: ComparisonOperatorSchema,
  value: z.number(),
  window: TimeWindowSchema.optional(),
  filters: z.array(FilterSchema).optional(),
  chain_id: z.number().int().positive().optional(),
  market_id: z.string().optional(),
  address: z.string().optional(),
});

const ChangeConditionSchema = z.object({
  type: z.literal("change"),
  metric: z.string(),
  direction: z.enum(["increase", "decrease", "any"]),
  by: z.union([z.object({ percent: z.number() }), z.object({ absolute: z.number() })]),
  window: TimeWindowSchema.optional(),
  chain_id: z.number().int().positive().optional(),
  market_id: z.string().optional(),
  address: z.string().optional(),
});

const AggregateConditionSchema = z.object({
  type: z.literal("aggregate"),
  aggregation: z.enum(["sum", "avg", "min", "max", "count"]),
  metric: z.string(),
  operator: ComparisonOperatorSchema,
  value: z.number(),
  window: TimeWindowSchema.optional(),
  filters: z.array(FilterSchema).optional(),
  chain_id: z.number().int().positive().optional(),
  market_id: z.string().optional(),
});

const RawEventSpecSchema = z
  .object({
    kind: z.enum(RAW_EVENT_KINDS),
    contract_addresses: z.array(z.string()).optional(),
    signature: z.string().trim().optional(),
    protocols: z.array(z.enum(RAW_EVENT_SWAP_PROTOCOLS)).optional(),
  })
  .superRefine((value, ctx) => {
    try {
      validateRawEventSpec(value);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof Error ? err.message : "invalid raw event specification",
      });
    }
  });

const RawEventsConditionSchema = z
  .object({
    type: z.literal("raw-events"),
    aggregation: z.enum(["sum", "avg", "min", "max", "count"]),
    operator: ComparisonOperatorSchema,
    value: z.number(),
    field: z.string().optional(),
    window: TimeWindowSchema.optional(),
    filters: z.array(FilterSchema).optional(),
    chain_id: z.number().int().positive().optional(),
    event: RawEventSpecSchema,
  })
  .superRefine((value, ctx) => {
    if (value.aggregation !== "count" && !value.field) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "field is required for raw-events aggregation unless aggregation is count",
        path: ["field"],
      });
    }
  });

// biome-ignore lint/style/useConst: Circular reference requires let for forward declaration
let ConditionSchema: z.ZodTypeAny;

const GroupConditionSchema: z.ZodTypeAny = z.lazy(() =>
  z.object({
    type: z.literal("group"),
    addresses: z.array(z.string()).min(1),
    window: TimeWindowSchema.optional(),
    logic: z.enum(["AND", "OR"]).optional(),
    requirement: z.object({
      count: z.number().int().positive(),
      of: z.number().int().positive(),
    }),
    conditions: z.array(ConditionSchema).min(1),
  }),
);

ConditionSchema = z.union([
  ThresholdConditionSchema,
  ChangeConditionSchema,
  GroupConditionSchema,
  AggregateConditionSchema,
  RawEventsConditionSchema,
]);

const SignalDefinitionSchema = z.object({
  scope: SignalScopeSchema,
  conditions: z.array(ConditionSchema).min(1),
  logic: z.enum(["AND", "OR"]).optional(),
  window: TimeWindowSchema,
});

const ManagedDeliverySchema = z.object({
  provider: z.literal("telegram"),
});

export const CreateSignalSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    definition: SignalDefinitionSchema,
    webhook_url: z.string().url().optional(),
    delivery: ManagedDeliverySchema.optional(),
    cooldown_minutes: z.number().int().min(0).default(5),
  })
  .superRefine((value, ctx) => {
    if (!value.webhook_url && !value.delivery) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "webhook_url or delivery is required",
        path: ["webhook_url"],
      });
    }
  });

export const UpdateSignalSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    definition: SignalDefinitionSchema.optional(),
    webhook_url: z.string().url().optional(),
    delivery: ManagedDeliverySchema.optional(),
    cooldown_minutes: z.number().int().min(0).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });
