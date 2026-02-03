import { GraphQLClient } from 'graphql-request';
import { config } from '../config/index.js';
import { EventRef, StateRef, Filter } from '../types/index.js';
import pino from 'pino';

const pinoFactory = (pino as any).default || pino;
const logger = pinoFactory();

/**
 * Error thrown when Envio queries fail.
 * Callers should handle this explicitly rather than receiving silent zeros.
 */
export class EnvioQueryError extends Error {
  constructor(
    message: string,
    public readonly queryCount: number
  ) {
    super(message);
    this.name = 'EnvioQueryError';
  }
}

/**
 * Query types for batching
 */
export interface StateQuery {
  type: 'state';
  ref: StateRef;
  alias: string;
}

export interface EventQuery {
  type: 'event';
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

  constructor(endpoint: string = config.envio.endpoint) {
    if (!endpoint) {
      throw new Error('Envio endpoint not configured');
    }
    this.client = new GraphQLClient(endpoint);
  }

  /**
   * Translate DSL filters to Hasura GraphQL filter syntax
   */
  private translateFilters(filters: Filter[]): Record<string, any> {
    const where: Record<string, any> = {};
    for (const filter of filters) {
      const opMap: Record<string, string> = {
        eq: '_eq',
        neq: '_neq',
        gt: '_gt',
        gte: '_gte',
        lt: '_lt',
        lte: '_lte',
        in: '_in',
        contains: '_ilike',
      };
      const gqlOp = opMap[filter.op] || '_eq';
      where[filter.field] = { [gqlOp]: filter.value };
    }
    return where;
  }

  /**
   * Build a state query fragment for batching
   * Note: Envio does NOT support time-travel (block: {number: X}).
   * For historical state, use RPC via src/rpc/client.ts instead.
   */
  private buildStateQueryFragment(query: StateQuery): { fragment: string; variables: Record<string, any> } {
    const where = this.translateFilters(query.ref.filters);

    return {
      fragment: `${query.alias}: ${query.ref.entity_type}(where: $${query.alias}_where, limit: 1) {
        ${query.ref.field}
      }`,
      variables: { [`${query.alias}_where`]: where }
    };
  }

  /**
   * Build an event query fragment for batching
   */
  private buildEventQueryFragment(query: EventQuery): { fragment: string; variables: Record<string, any> } {
    const where = this.translateFilters(this.remapEventFilters(query.ref.filters));
    const entityName = query.ref.event_type.startsWith('Morpho_')
      ? query.ref.event_type
      : `Morpho_${query.ref.event_type}`;

    where['timestamp'] = {
      _gte: Math.floor(query.startTimeMs / 1000),
      _lte: Math.floor(query.endTimeMs / 1000)
    };

    return {
      fragment: `${query.alias}: ${entityName}(where: $${query.alias}_where) {
        ${query.ref.field}
      }`,
      variables: { [`${query.alias}_where`]: where }
    };
  }

  /**
   * Remap event filter fields to match indexer schema differences.
   */
  private remapEventFilters(filters: Filter[]): Filter[] {
    const marketField = config.envio.eventMarketField;
    const userField = config.envio.eventUserField;

    return filters.map((filter) => {
      if (filter.field === 'marketId' && marketField !== 'marketId') {
        return { ...filter, field: marketField };
      }
      if (filter.field === 'user' && userField !== 'user') {
        return { ...filter, field: userField };
      }
      return filter;
    });
  }

  /**
   * Build variable definitions for the batch query
   */
  private buildVariableDefinitions(queries: BatchQuery[]): string {
    return queries.map(q => {
      const entityName = q.type === 'state'
        ? q.ref.entity_type
        : (q.ref.event_type.startsWith('Morpho_') ? q.ref.event_type : `Morpho_${q.ref.event_type}`);
      return `$${q.alias}_where: ${entityName}_bool_exp!`;
    }).join(', ');
  }

  /**
   * Execute multiple queries in a single GraphQL request
   */
  async batchQueries(queries: BatchQuery[]): Promise<BatchResult> {
    if (queries.length === 0) return {};

    const fragments: string[] = [];
    let variables: Record<string, any> = {};

    for (const query of queries) {
      const built = query.type === 'state'
        ? this.buildStateQueryFragment(query)
        : this.buildEventQueryFragment(query);

      fragments.push(built.fragment);
      variables = { ...variables, ...built.variables };
    }

    const variableDefs = this.buildVariableDefinitions(queries);
    const batchQuery = `
      query BatchQuery(${variableDefs}) {
        ${fragments.join('\n        ')}
      }
    `;

    try {
      const data: any = await this.client.request(batchQuery, variables);
      const results: BatchResult = {};

      for (const query of queries) {
        const rows = data[query.alias] || [];

        if (query.type === 'state') {
          const entity = rows[0];
          results[query.alias] = entity ? Number(entity[query.ref.field]) : 0;
        } else {
          results[query.alias] = this.aggregateInMemory(rows, query.ref);
        }
      }

      return results;
    } catch (error: any) {
      logger.error({ error: error.message, queryCount: queries.length }, 'Envio batch query failed');
      // Propagate error - do NOT silently return zeros
      throw new EnvioQueryError(
        `Envio batch query failed: ${error.message}`,
        queries.length
      );
    }
  }

  /**
   * Perform in-memory aggregation on event rows
   */
  private aggregateInMemory(rows: any[], ref: EventRef): number {
    if (rows.length === 0) return 0;

    const values = rows.map((r: any) => {
      const val = r[ref.field];
      return val === undefined || val === null ? 0 : Number(val);
    });

    switch (ref.aggregation) {
      case 'sum':
        return values.reduce((a, b) => a + b, 0);
      case 'count':
        return rows.length;
      case 'avg':
        return values.reduce((a, b) => a + b, 0) / rows.length;
      case 'min':
        return Math.min(...values);
      case 'max':
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
    const result = await this.batchQueries([{
      type: 'state',
      ref,
      alias: 'result'
    }]);
    return result['result'];
  }

  /**
   * Fetch and aggregate events in a time window
   */
  async fetchEvents(ref: EventRef, startTimeMs: number, endTimeMs: number): Promise<number> {
    const result = await this.batchQueries([{
      type: 'event',
      ref,
      startTimeMs,
      endTimeMs,
      alias: 'result'
    }]);
    return result['result'];
  }

  /**
   * Fetch raw positions without aggregation (current state only).
   * Note: Envio does NOT support block-parameter time-travel. Use RPC for point-in-time state.
   */
  async fetchPositions(chainId: number, filters: Filter[]): Promise<Position[]> {
    const where = this.translateFilters(filters);
    where['chainId'] = { _eq: chainId };

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
      const data: any = await this.client.request(query, { where });
      return data.Position || [];
    } catch (error: any) {
      logger.error({ error: error.message, chainId }, 'Envio positions fetch failed');
      return [];
    }
  }

  /**
   * Fetch raw markets without aggregation (current state only).
   * Note: Envio does NOT support block-parameter time-travel. Use RPC for point-in-time state.
   */
  async fetchMarkets(chainId: number, filters: Filter[] = []): Promise<Market[]> {
    const where = this.translateFilters(filters);
    where['chainId'] = { _eq: chainId };

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
      const data: any = await this.client.request(query, { where });
      return data.Market || [];
    } catch (error: any) {
      logger.error({ error: error.message, chainId }, 'Envio markets fetch failed');
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
    filters: Filter[] = []
  ): Promise<MorphoEvent[]> {
    const where = this.translateFilters(this.remapEventFilters(filters));
    const entityName = eventType.startsWith('Morpho_') ? eventType : `Morpho_${eventType}`;

    where['chainId'] = { _eq: chainId };
    where['timestamp'] = {
      _gte: Math.floor(startTimeMs / 1000),
      _lte: Math.floor(endTimeMs / 1000)
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
      const data: any = await this.client.request(query, { where });
      return data[entityName] || [];
    } catch (error: any) {
      logger.error({ error: error.message, eventType, chainId }, 'Envio raw events fetch failed');
      return [];
    }
  }
}
