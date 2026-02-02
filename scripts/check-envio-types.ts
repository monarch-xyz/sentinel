import { GraphQLClient, gql } from 'graphql-request';

const endpoint = 'https://indexer.hyperindex.xyz/fa02682/v1/graphql';
const client = new GraphQLClient(endpoint);

async function checkTypes() {
  console.log('--- Checking Position Types ---');
  const posQuery = gql`
    query {
      Position(limit: 1) {
        supplyShares
        borrowShares
        collateral
      }
    }
  `;
  try {
    const posData = await client.request(posQuery);
    console.log('Position Sample:', JSON.stringify(posData, null, 2));
  } catch (e) {
    console.error('Position query failed');
  }

  console.log('\n--- Checking Supply Event Types ---');
  const supplyQuery = gql`
    query {
      Morpho_Supply(limit: 1) {
        assets
        shares
        timestamp
        market_id
      }
    }
  `;
  try {
    const supplyData = await client.request(supplyQuery);
    console.log('Supply Sample:', JSON.stringify(supplyData, null, 2));
  } catch (e) {
    console.error('Supply query failed');
  }
}

checkTypes();
