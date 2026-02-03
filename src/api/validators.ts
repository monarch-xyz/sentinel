import { z } from 'zod';

const SignalScopeSchema = z.object({
  chains: z.array(z.number().int().positive()).min(1),
  markets: z.array(z.string()).optional(),
  addresses: z.array(z.string()).optional(),
  protocol: z.enum(['morpho', 'all']).optional(),
});

const TimeWindowSchema = z.object({
  duration: z.string(),
  lookback_blocks: z.number().int().positive().optional(),
});

const ComparisonOperatorSchema = z.enum(['>', '<', '>=', '<=', '==', '!=']);

const ThresholdConditionSchema = z.object({
  type: z.literal('threshold'),
  metric: z.string(),
  operator: ComparisonOperatorSchema,
  value: z.number(),
  chain_id: z.number().int().positive().optional(),
  market_id: z.string().optional(),
  address: z.string().optional(),
});

const ChangeConditionSchema = z.object({
  type: z.literal('change'),
  metric: z.string(),
  direction: z.enum(['increase', 'decrease', 'any']),
  by: z.union([
    z.object({ percent: z.number() }),
    z.object({ absolute: z.number() }),
  ]),
  chain_id: z.number().int().positive().optional(),
  market_id: z.string().optional(),
  address: z.string().optional(),
});

const AggregateConditionSchema = z.object({
  type: z.literal('aggregate'),
  aggregation: z.enum(['sum', 'avg', 'min', 'max', 'count']),
  metric: z.string(),
  operator: ComparisonOperatorSchema,
  value: z.number(),
  chain_id: z.number().int().positive().optional(),
  market_id: z.string().optional(),
});

let ConditionSchema: z.ZodTypeAny;

const GroupConditionSchema: z.ZodTypeAny = z.lazy(() =>
  z.object({
    type: z.literal('group'),
    addresses: z.array(z.string()).min(1),
    requirement: z.object({
      count: z.number().int().positive(),
      of: z.number().int().positive(),
    }),
    condition: ConditionSchema,
  })
);

ConditionSchema = z.union([
  ThresholdConditionSchema,
  ChangeConditionSchema,
  GroupConditionSchema,
  AggregateConditionSchema,
]);

const SignalDefinitionSchema = z.object({
  scope: SignalScopeSchema,
  conditions: z.array(ConditionSchema).min(1),
  logic: z.enum(['AND', 'OR']).optional(),
  window: TimeWindowSchema,
});

export const CreateSignalSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  definition: SignalDefinitionSchema,
  webhook_url: z.string().url(),
  cooldown_minutes: z.number().int().min(0).default(5),
});

export const UpdateSignalSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  definition: SignalDefinitionSchema.optional(),
  webhook_url: z.string().url().optional(),
  cooldown_minutes: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update',
});
