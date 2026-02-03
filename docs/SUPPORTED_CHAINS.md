# Supported Chains

Flare supports the following blockchain networks for signal monitoring:

## Production Chains

| Chain | Chain ID | Block Time | Status |
|-------|----------|------------|--------|
| Ethereum | 1 | ~12s | ✅ Live |
| Base | 8453 | ~2s | ✅ Live |
| Polygon | 137 | ~2s | ✅ Live |
| Arbitrum | 42161 | ~0.25s | ✅ Live |

## Upcoming Chains

| Chain | Chain ID | Block Time | Status |
|-------|----------|------------|--------|
| Monad | 10143 | ~0.5s | 🔜 Pending mainnet |
| Unichain | 130 | ~2s | 🔜 Pending mainnet |
| Hyperliquid | 999 | ~1s | 🔜 Pending mainnet |

> **Note:** Chain IDs for newer chains may change before mainnet launch. Update `src/envio/blocks.ts` when official chain IDs are confirmed.

## RPC Configuration

Configure custom RPC endpoints via environment variables:

```bash
# Format: RPC_URL_{chainId}
# Multiple URLs can be comma-separated for fallback

RPC_URL_1=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
RPC_URL_8453=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
RPC_URL_137=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
RPC_URL_42161=https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY
RPC_URL_10143=https://rpc.monad.xyz
RPC_URL_130=https://rpc.unichain.org
RPC_URL_999=https://rpc.hyperliquid.xyz
```

If no custom RPC is set, Flare falls back to public RPC endpoints.

## Adding New Chains

To add a new chain, update `src/envio/blocks.ts`:

```typescript
const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  // Add your chain:
  NEW_CHAIN_ID: {
    name: 'Chain Name',
    rpcEndpoints: ['https://rpc.example.com'],
    genesisTimestamp: 1234567890, // Unix timestamp of genesis block
    avgBlockTimeMs: 2000,         // Average block time in ms
  },
};
```

## Not Supported

The following chains are **not** currently supported:
- Optimism (chainId: 10)
- Avalanche (chainId: 43114)
- BSC (chainId: 56)

Contact the team if you need support for additional chains.
