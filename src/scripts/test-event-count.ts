/**
 * Quick sanity script: count Morpho_Supply events for specific addresses in a time window.
 *
 * Usage:
 *   ENVIO_ENDPOINT=... tsx src/scripts/test-event-count.ts
 */

import { GraphQLClient } from 'graphql-request';
import { EnvioClient } from '../envio/client.js';
import type { EventRef } from '../types/index.js';
import { parseDuration } from '../utils/duration.js';
import { config } from '../config/index.js';

async function main() {
  const addresses = (process.env.EVENT_ADDRESSES ?? '0xA,0xB,0xC')
    .split(',')
    .map((addr) => addr.trim())
    .filter(Boolean);
  const chainId = Number(process.env.EVENT_CHAIN_ID ?? 1);
  const marketId = process.env.EVENT_MARKET_ID ?? '';
  const window = process.env.EVENT_WINDOW ?? '6h';
  const threshold = Number(process.env.EVENT_COUNT_THRESHOLD ?? 25);

  const eventType = process.env.EVENT_TYPE ?? 'Morpho_Supply';
  const chainField = process.env.EVENT_CHAIN_FIELD ?? 'chainId';
  let marketField = process.env.EVENT_MARKET_FIELD ?? '';
  let userField = process.env.EVENT_USER_FIELD ?? '';

  if (!marketField || !userField) {
    const endpoint = config.envio.endpoint;
    if (!endpoint) {
      throw new Error('ENVIO_ENDPOINT is required to auto-detect event fields');
    }

    const client = new GraphQLClient(endpoint);
    const boolExpType = `${eventType}_bool_exp`;
    const query = `\n      query IntrospectBoolExp($name: String!) {\n        __type(name: $name) {\n          inputFields { name }\n        }\n      }\n    `;

    const result: any = await client.request(query, { name: boolExpType });
    const fields: string[] = result?.__type?.inputFields?.map((f: any) => f.name) ?? [];

    if (!marketField) {
      marketField = fields.includes('market_id') ? 'market_id' : fields.includes('marketId') ? 'marketId' : '';
    }

    if (!userField) {
      if (fields.includes('onBehalf')) userField = 'onBehalf';
      else if (fields.includes('user')) userField = 'user';
      else if (fields.includes('caller')) userField = 'caller';
    }

    if (!userField) {
      throw new Error(`Could not detect user field for ${eventType}. Set EVENT_USER_FIELD explicitly.`);
    }
  }

  const endTimeMs = Date.now();
  const startTimeMs = endTimeMs - parseDuration(window);

  const filters: EventRef['filters'] = [
    { field: chainField, op: 'eq', value: chainId },
  ];

  if (marketId && marketField) {
    filters.push({ field: marketField, op: 'eq', value: marketId });
  }

  if (addresses.length > 0) {
    filters.push({
      field: userField,
      op: addresses.length === 1 ? 'eq' : 'in',
      value: addresses.length === 1 ? addresses[0]! : addresses,
    });
  }

  const ref: EventRef = {
    type: 'event',
    event_type: eventType,
    field: 'id',
    aggregation: 'count',
    filters,
  };

  const client = new EnvioClient();
  const count = await client.fetchEvents(ref, startTimeMs, endTimeMs);

  console.log(
    JSON.stringify(
      {
        chainId,
        marketId: marketId || undefined,
        addresses,
        window,
        startTime: new Date(startTimeMs).toISOString(),
        endTime: new Date(endTimeMs).toISOString(),
        count,
        threshold,
        triggered: count > threshold,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('Event count script failed:', error);
  process.exit(1);
});
