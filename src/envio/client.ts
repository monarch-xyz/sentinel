import { GraphQLClient } from "graphql-request";
import { config } from "../config/index.js";
import type { EventRef, Filter, StateRef } from "../types/index.js";
import { getErrorMessage } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

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

/**
 * Query types for batching
 */
export interface StateQuery {
  type: "state";
  ref: StateRef;
  alias: string;
}

export interface EventQuery {
  type: "event";
  ref: EventRef;
  startTimeMs: number;
  endTimeMs: number;
  alias: string;
}

export type BatchQuery = StateQuery | EventQuery;

export interface BatchResult {
  [alias: string]: number;
}

/**
 * Position entity from Envio
 */
export interface Position {
  id: string;
  chainId: number;
  user: string;
  marketId: string;
  supplyShares: string;
  borrowShares: string;
  collateral: string;
  lastUpdateTimestamp: number;
}

/**
 * Market entity from Envio
 */
export interface Market {
  id: string;
  chainId: number;
  loanToken: string;
  collateralToken: string;
  oracle: string;
  irm: string;
  lltv: string;
  totalSupplyAssets: string;
  totalSupplyShares: string;
  totalBorrowAssets: string;
  totalBorrowShares: string;
  fee: string;
  lastUpdate: number;
}

/**
 * Generic Morpho event
 */
export interface MorphoEvent {
  id: string;
  chainId: number;
  timestamp: number;
  transactionHash: string;
  logIndex: number;
  [key: string]: unknown;
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
   * Build a state query fragment for batching
   * Note: Envio does NOT support time-travel (block: {number: X}).
   * For historical state, use RPC via src/rpc/client.ts instead.
   */
  private buildStateQueryFragment(query: StateQuery): {
    fragment: string;
    variables: Record<string, GraphQLFilterValue>;
  } {
    const where = this.translateFilters(query.ref.filters);

    return {
      fragment: `${query.alias}: ${query.ref.entity_type}(where: $${query.alias}_where, limit: 1) {
        ${query.ref.field}
      }`,
      variables: { [`${query.alias}_where`]: where },
    };
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
        return { ...filter, field: "market_id" };
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
      .map((q) => {
        const entityName =
          q.type === "state" ? q.ref.entity_type : this.normalizeEventEntityName(q.ref.event_type);
        return `$${q.alias}_where: ${entityName}_bool_exp!`;
      })
      .join(", ");
  }

  /**
   * Execute multiple queries in a single GraphQL request
   */
  async batchQueries(queries: BatchQuery[]): Promise<BatchResult> {
    if (queries.length === 0) return {};

    const normalizedQueries: BatchQuery[] = [];
    for (const query of queries) {
      if (query.type === "event") {
        const remappedFilters = this.remapEventFilters(query.ref.filters);
        await this.validateEventFilterFields(query.ref.event_type, remappedFilters);
        normalizedQueries.push({
          ...query,
          ref: {
            ...query.ref,
            filters: remappedFilters,
          },
        });
      } else {
        normalizedQueries.push(query);
      }
    }

    const fragments: string[] = [];
    let variables: Record<string, GraphQLFilterValue> = {};

    for (const query of normalizedQueries) {
      const built =
        query.type === "state"
          ? this.buildStateQueryFragment(query)
          : this.buildEventQueryFragment(query);

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

        if (query.type === "state") {
          const entity = rows[0];
          results[query.alias] = entity ? Number(entity[query.ref.field]) : 0;
        } else {
          results[query.alias] = this.aggregateInMemory(rows, query.ref);
        }
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
   * Fetch current indexed state from Envio.
   * Note: Envio does NOT support block-parameter time-travel.
   * Point-in-time state reads use RPC via src/rpc/client.ts.
   */
  async fetchState(ref: StateRef): Promise<number> {
    const result = await this.batchQueries([
      {
        type: "state",
        ref,
        alias: "result",
      },
    ]);
    return result.result;
  }

  /**
   * Fetch and aggregate events in a time window
   */
  async fetchEvents(ref: EventRef, startTimeMs: number, endTimeMs: number): Promise<number> {
    const result = await this.batchQueries([
      {
        type: "event",
        ref,
        startTimeMs,
        endTimeMs,
        alias: "result",
      },
    ]);
    return result.result;
  }

  /**
   * Fetch raw positions without aggregation (current state only).
   * Note: Envio does NOT support block-parameter time-travel. Use RPC for point-in-time state.
   */
  async fetchPositions(chainId: number, filters: Filter[]): Promise<Position[]> {
    const where = this.translateFilters(filters);
    where.chainId = { _eq: chainId };

    const query = `
      query GetPositions($where: Position_bool_exp!) {
        Position(where: $where) {
          id
          chainId
          user
          marketId
          supplyShares
          borrowShares
          collateral
          lastUpdateTimestamp
        }
      }
    `;

    try {
      const data = (await this.client.request(query, { where })) as { Position?: Position[] };
      return data.Position || [];
    } catch (error: unknown) {
      logger.error({ error: getErrorMessage(error), chainId }, "Envio positions fetch failed");
      return [];
    }
  }

  /**
   * Fetch raw markets without aggregation (current state only).
   * Note: Envio does NOT support block-parameter time-travel. Use RPC for point-in-time state.
   */
  async fetchMarkets(chainId: number, filters: Filter[] = []): Promise<Market[]> {
    const where = this.translateFilters(filters);
    where.chainId = { _eq: chainId };

    const query = `
      query GetMarkets($where: Market_bool_exp!) {
        Market(where: $where) {
          id
          chainId
          loanToken
          collateralToken
          oracle
          irm
          lltv
          totalSupplyAssets
          totalSupplyShares
          totalBorrowAssets
          totalBorrowShares
          fee
          lastUpdate
        }
      }
    `;

    try {
      const data = (await this.client.request(query, { where })) as { Market?: Market[] };
      return data.Market || [];
    } catch (error: unknown) {
      logger.error({ error: getErrorMessage(error), chainId }, "Envio markets fetch failed");
      return [];
    }
  }

  /**
   * Fetch raw events without aggregation
   */
  async fetchRawEvents(
    eventType: string,
    chainId: number,
    startTimeMs: number,
    endTimeMs: number,
    filters: Filter[] = [],
  ): Promise<MorphoEvent[]> {
    const remappedFilters = this.remapEventFilters(filters);
    await this.validateEventFilterFields(eventType, remappedFilters);
    const where = this.translateFilters(remappedFilters);
    const entityName = this.normalizeEventEntityName(eventType);

    where.chainId = { _eq: chainId };
    where.timestamp = {
      _gte: Math.floor(startTimeMs / 1000),
      _lte: Math.floor(endTimeMs / 1000),
    };

    const query = `
      query GetRawEvents($where: ${entityName}_bool_exp!) {
        ${entityName}(where: $where, order_by: {timestamp: desc}) {
          id
          chainId
          timestamp
          transactionHash
          logIndex
        }
      }
    `;

    try {
      const data = (await this.client.request(query, { where })) as Record<string, MorphoEvent[]>;
      return data[entityName] || [];
    } catch (error: unknown) {
      logger.error(
        { error: getErrorMessage(error), eventType, chainId },
        "Envio raw events fetch failed",
      );
      return [];
    }
  }
}
