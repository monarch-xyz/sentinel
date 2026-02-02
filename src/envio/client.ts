import { GraphQLClient, gql } from 'graphql-request';
import { config } from '../config/index.js';
import { EventRef, StateRef, Filter } from '../types/index.js';
import pino from 'pino';

const logger = pino();

export class EnvioClient {
  private client: GraphQLClient;

  constructor(endpoint: string = config.envio.endpoint) {
    if (!endpoint) {
      throw new Error('Envio endpoint not configured');
    }
    this.client = new GraphQLClient(endpoint);
  }

  /**
   * Translates generic filters to Hasura/GraphQL where clauses
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
   * Fetch entity state at current or specific block (time-travel)
   */
  async fetchState(ref: StateRef, blockNumber?: number): Promise<number> {
    const where = this.translateFilters(ref.filters);
    
    // Time-travel filter
    const blockFilter = blockNumber ? `(block: { number: ${blockNumber} })` : '';
    
    const query = gql`
      query GetState($where: ${ref.entity_type}_bool_exp!) {
        ${ref.entity_type}${blockFilter}(where: $where, limit: 1) {
          ${ref.field}
        }
      }
    `;

    try {
      const data: any = await this.client.request(query, { where });
      const entity = data[ref.entity_type]?.[0];
      return entity ? Number(entity[ref.field]) : 0;
    } catch (error: any) {
      logger.error({ error: error.message, ref }, 'Envio state fetch failed');
      return 0;
    }
  }

  /**
   * Fetch aggregated events over time window
   */
  async fetchEvents(ref: EventRef, startTime: number, endTime: number): Promise<number> {
    const where = this.translateFilters(ref.filters);
    
    // Add time window to filters
    // Note: mapping 'Supply' -> 'Morpho_Supply' based on our indexer schema
    const entityName = ref.event_type.startsWith('Morpho_') ? ref.event_type : `Morpho_${ref.event_type}`;
    
    // We assume the indexer has a 'timestamp' field (standard Envio)
    where['timestamp'] = { _gte: Math.floor(startTime / 1000), _lte: Math.floor(endTime / 1000) };

    const query = gql`
      query GetEvents($where: ${entityName}_bool_exp!) {
        ${entityName}_aggregate(where: $where) {
          aggregate {
            ${ref.aggregation} {
              ${ref.field}
            }
          }
        }
      }
    `;

    try {
      const data: any = await this.client.request(query, { where });
      const val = data[`${entityName}_aggregate`]?.aggregate?.[ref.aggregation]?.[ref.field];
      return val ? Number(val) : 0;
    } catch (error: any) {
      logger.error({ error: error.message, ref }, 'Envio event fetch failed');
      return 0;
    }
  }
}
