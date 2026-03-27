import { GraphQLClient } from "graphql-request";
import { config } from "../config/index.js";
import type { EventRef, Filter } from "../types/index.js";
import { getErrorMessage } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";
import { normalizeMarketId } from "../utils/market.js";

// ============================================
// GraphQL Types
// ============================================

/** Generic GraphQL filter value */
type GraphQLFilterValue = Record<string, unknown>;

/** GraphQL response with dynamic aliases */
type GraphQLResponse = Record<string, unknown[] | undefined>;

/** Single entity row from GraphQL */
type GraphQLRow = Record<string, unknown>;

const logger = createLogger("envio-client");

/**
 * Error thrown when Envio queries fail.
 * Callers should handle this explicitly rather than receiving silent zeros.
 */
export class EnvioQueryError extends Error {
  constructor(
    message: string,
    public readonly queryCount: number,
  ) {
    super(message);
    this.name = "EnvioQueryError";
  }
}

export interface EventQuery {
  ref: EventRef;
  startTimeMs: number;
  endTimeMs: number;
  alias: string;
}

export type BatchQuery = EventQuery;

export interface BatchResult {
  [alias: string]: number;
}

export class EnvioClient {
  private client: GraphQLClient;
  private static filterSchemaCache = new Map<string, Set<string> | null>();

  constructor(endpoint: string = config.envio.endpoint) {
    if (!endpoint) {
      throw new Error("Envio endpoint not configured");
    }
    this.client = new GraphQLClient(endpoint);
  }

  private normalizeEventEntityName(eventType: string): string {
    return eventType.startsWith("Morpho_") ? eventType : `Morpho_${eventType}`;
  }

  private async loadEventFilterSchema(eventType: string): Promise<Set<string> | null> {
    const entityName = this.normalizeEventEntityName(eventType);
    if (EnvioClient.filterSchemaCache.has(entityName)) {
      return EnvioClient.filterSchemaCache.get(entityName) ?? null;
    }

    const query = `
      query IntrospectEventFilters($name: String!) {
        __type(name: $name) {
          inputFields { name }
        }
      }
    `;

    try {
      const result = await this.client.request<{ __type?: { inputFields?: { name: string }[] } }>(
        query,
        { name: `${entityName}_bool_exp` },
      );

      const fields = new Set<string>(result.__type?.inputFields?.map((field) => field.name) ?? []);
      EnvioClient.filterSchemaCache.set(entityName, fields);
      return fields;
    } catch {
      EnvioClient.filterSchemaCache.set(entityName, null);
      logger.warn({ eventType }, "Envio schema introspection failed; skipping filter validation");
      return null;
    }
  }

  private async validateEventFilterFields(eventType: string, filters: Filter[]): Promise<void> {
    if (!config.envio.validateSchema || filters.length === 0) return;
    const fields = await this.loadEventFilterSchema(eventType);
    if (!fields) return;

    for (const filter of filters) {
      if (!fields.has(filter.field)) {
        throw new Error(`Event filter field "${filter.field}" not found in ${eventType}_bool_exp`);
      }
    }
  }

  /**
   * Translate DSL filters to Hasura GraphQL filter syntax
   */
  private translateFilters(filters: Filter[]): GraphQLFilterValue {
    const where: GraphQLFilterValue = {};
    for (const filter of filters) {
      const opMap: Record<string, string> = {
        eq: "_eq",
        neq: "_neq",
        gt: "_gt",
        gte: "_gte",
        lt: "_lt",
        lte: "_lte",
        in: "_in",
        contains: "_ilike",
      };
      const gqlOp = opMap[filter.op] || "_eq";
      where[filter.field] = { [gqlOp]: filter.value };
    }
    return where;
  }

  /**
   * Build an event query fragment for batching
   */
  private buildEventQueryFragment(query: EventQuery): {
    fragment: string;
    variables: Record<string, GraphQLFilterValue>;
  } {
    const where = this.translateFilters(query.ref.filters);
    const entityName = this.normalizeEventEntityName(query.ref.event_type);

    where.timestamp = {
      _gte: Math.floor(query.startTimeMs / 1000),
      _lte: Math.floor(query.endTimeMs / 1000),
    };

    return {
      fragment: `${query.alias}: ${entityName}(where: $${query.alias}_where) {
        ${query.ref.field}
      }`,
      variables: { [`${query.alias}_where`]: where },
    };
  }

  /**
   * Remap event filter fields to match indexer schema differences.
   */
  private remapEventFilters(filters: Filter[]): Filter[] {
    return filters.map((filter) => {
      if (filter.field === "marketId") {
        return {
          ...filter,
          field: "market_id",
          value: typeof filter.value === "string" ? normalizeMarketId(filter.value) : filter.value,
        };
      }
      if (filter.field === "market_id") {
        return {
          ...filter,
          value: typeof filter.value === "string" ? normalizeMarketId(filter.value) : filter.value,
        };
      }
      if (filter.field === "user") {
        return { ...filter, field: "onBehalf" };
      }
      return filter;
    });
  }

  /**
   * Build variable definitions for the batch query
   */
  private buildVariableDefinitions(queries: BatchQuery[]): string {
    return queries
      .map((q) => `$${q.alias}_where: ${this.normalizeEventEntityName(q.ref.event_type)}_bool_exp!`)
      .join(", ");
  }

  /**
   * Execute multiple queries in a single GraphQL request
   */
  async batchQueries(queries: BatchQuery[]): Promise<BatchResult> {
    if (queries.length === 0) return {};

    const normalizedQueries: BatchQuery[] = [];
    for (const query of queries) {
      const remappedFilters = this.remapEventFilters(query.ref.filters);
      await this.validateEventFilterFields(query.ref.event_type, remappedFilters);
      normalizedQueries.push({
        ...query,
        ref: {
          ...query.ref,
          filters: remappedFilters,
        },
      });
    }

    const fragments: string[] = [];
    let variables: Record<string, GraphQLFilterValue> = {};

    for (const query of normalizedQueries) {
      const built = this.buildEventQueryFragment(query);
      fragments.push(built.fragment);
      variables = { ...variables, ...built.variables };
    }

    const variableDefs = this.buildVariableDefinitions(normalizedQueries);
    const batchQuery = `
      query BatchQuery(${variableDefs}) {
        ${fragments.join("\n        ")}
      }
    `;

    try {
      const data = (await this.client.request(batchQuery, variables)) as GraphQLResponse;
      const results: BatchResult = {};

      for (const query of normalizedQueries) {
        const rows = (data[query.alias] || []) as GraphQLRow[];
        results[query.alias] = this.aggregateInMemory(rows, query.ref);
      }

      return results;
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      logger.error({ error: message, queryCount: queries.length }, "Envio batch query failed");
      // Propagate error - do NOT silently return zeros
      throw new EnvioQueryError(`Envio batch query failed: ${message}`, queries.length);
    }
  }

  /**
   * Perform in-memory aggregation on event rows
   */
  private aggregateInMemory(rows: GraphQLRow[], ref: EventRef): number {
    if (rows.length === 0) return 0;

    const values = rows.map((r) => {
      const val = r[ref.field];
      return val === undefined || val === null ? 0 : Number(val);
    });

    switch (ref.aggregation) {
      case "sum":
        return values.reduce((a, b) => a + b, 0);
      case "count":
        return rows.length;
      case "avg":
        return values.reduce((a, b) => a + b, 0) / rows.length;
      case "min":
        return Math.min(...values);
      case "max":
        return Math.max(...values);
      default:
        return 0;
    }
  }

  /**
   * Fetch and aggregate events in a time window
   */
  async fetchEvents(ref: EventRef, startTimeMs: number, endTimeMs: number): Promise<number> {
    const result = await this.batchQueries([
      {
        ref,
        startTimeMs,
        endTimeMs,
        alias: "result",
      },
    ]);
    return result.result;
  }
}

export async function probeEnvioEndpoint(endpoint: string = config.envio.endpoint): Promise<void> {
  if (!endpoint) {
    throw new Error("Envio endpoint not configured");
  }

  const client = new GraphQLClient(endpoint);
  await client.request<{ __schema: { queryType: { name: string } } }>(`
    query EnvioHealthcheck {
      __schema {
        queryType {
          name
        }
      }
    }
  `);
}
