import { beforeEach, describe, expect, it, vi } from "vitest";
import { type BatchQuery, EnvioClient, EnvioQueryError } from "../../src/envio/client.js";
import type { FilterOp } from "../../src/types/index.js";

const mockRequest = vi.fn();
vi.mock("graphql-request", () => {
  return {
    GraphQLClient: vi.fn().mockImplementation(() => ({
      request: mockRequest,
    })),
  };
});

describe("EnvioClient", () => {
  let client: EnvioClient;

  beforeEach(() => {
    mockRequest.mockReset();
    client = new EnvioClient("https://mock-envio.endpoint");
  });

  describe("fetchEvents", () => {
    it("aggregates event rows and remaps user filters", async () => {
      mockRequest.mockResolvedValue({
        result: [{ assets: "1000" }, { assets: "2000" }, { assets: "500" }],
      });

      const result = await client.fetchEvents(
        {
          type: "event",
          event_type: "Supply",
          filters: [{ field: "user", op: "eq", value: "0x123" }],
          field: "assets",
          aggregation: "sum",
        },
        1700000000000,
        1700003600000,
      );

      expect(result).toBe(3500);
      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining("Morpho_Supply"),
        expect.objectContaining({
          result_where: expect.objectContaining({
            onBehalf: { _eq: "0x123" },
            timestamp: { _gte: 1700000000, _lte: 1700003600 },
          }),
        }),
      );
    });

    it("throws EnvioQueryError on GraphQL failure", async () => {
      mockRequest.mockRejectedValue(new Error("GraphQL error"));

      await expect(
        client.fetchEvents(
          {
            type: "event",
            event_type: "Supply",
            filters: [],
            field: "assets",
            aggregation: "sum",
          },
          0,
          Date.now(),
        ),
      ).rejects.toThrow(EnvioQueryError);
    });
  });

  describe("batchQueries", () => {
    it("executes multiple event queries in one request", async () => {
      mockRequest.mockResolvedValue({
        supplies: [{ assets: "1000" }, { assets: "2000" }],
        withdrawals: [{ assets: "500" }],
      });

      const queries: BatchQuery[] = [
        {
          ref: {
            type: "event",
            event_type: "Supply",
            filters: [],
            field: "assets",
            aggregation: "sum",
          },
          startTimeMs: 0,
          endTimeMs: Date.now(),
          alias: "supplies",
        },
        {
          ref: {
            type: "event",
            event_type: "Withdraw",
            filters: [],
            field: "assets",
            aggregation: "sum",
          },
          startTimeMs: 0,
          endTimeMs: Date.now(),
          alias: "withdrawals",
        },
      ];

      expect(await client.batchQueries(queries)).toEqual({
        supplies: 3000,
        withdrawals: 500,
      });
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it("returns an empty object for an empty batch", async () => {
      expect(await client.batchQueries([])).toEqual({});
      expect(mockRequest).not.toHaveBeenCalled();
    });
  });

  describe("raw helpers", () => {
    it("fetches raw positions", async () => {
      mockRequest.mockResolvedValue({
        Position: [
          {
            id: "pos1",
            chainId: 1,
            user: "0x123",
            marketId: "market1",
            supplyShares: "1000",
            borrowShares: "0",
            collateral: "5000",
          },
        ],
      });

      const positions = await client.fetchPositions(1, [
        { field: "marketId", op: "eq", value: "market1" },
      ]);

      expect(positions).toHaveLength(1);
      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining("Position"),
        expect.objectContaining({
          where: {
            marketId: { _eq: "market1" },
            chainId: { _eq: 1 },
          },
        }),
      );
    });

    it("fetches raw markets", async () => {
      mockRequest.mockResolvedValue({
        Market: [
          {
            id: "market1",
            chainId: 1,
            loanToken: "0xtoken1",
            collateralToken: "0xtoken2",
            oracle: "0xoracle",
            irm: "0xirm",
            lltv: "800000000000000000",
            totalSupplyAssets: "1000000",
            totalSupplyShares: "1000000",
            totalBorrowAssets: "500000",
            totalBorrowShares: "500000",
            fee: "0",
            lastUpdate: 1700000000,
          },
        ],
      });

      const markets = await client.fetchMarkets(1);

      expect(markets).toHaveLength(1);
      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining("Market"),
        expect.objectContaining({
          where: { chainId: { _eq: 1 } },
        }),
      );
    });

    it("fetches raw events", async () => {
      mockRequest.mockResolvedValue({
        Morpho_Supply: [
          {
            id: "event1",
            chainId: 1,
            timestamp: 1700000000,
            transactionHash: "0xabc",
            logIndex: 0,
          },
        ],
      });

      const events = await client.fetchRawEvents("Supply", 1, 1700000000000, 1700003600000, [
        { field: "user", op: "eq", value: "0x123" },
      ]);

      expect(events).toHaveLength(1);
      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining("Morpho_Supply"),
        expect.objectContaining({
          where: {
            onBehalf: { _eq: "0x123" },
            chainId: { _eq: 1 },
            timestamp: { _gte: 1700000000, _lte: 1700003600 },
          },
        }),
      );
    });
  });

  describe("filter operators", () => {
    it.each([
      ["eq", "_eq"],
      ["neq", "_neq"],
      ["gt", "_gt"],
      ["gte", "_gte"],
      ["lt", "_lt"],
      ["lte", "_lte"],
      ["in", "_in"],
      ["contains", "_ilike"],
    ])("translates %s to %s", async (op, gqlOp) => {
      mockRequest.mockResolvedValue({ Position: [] });

      await client.fetchPositions(1, [{ field: "testField", op: op as FilterOp, value: "test" }]);

      expect(mockRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          where: {
            testField: { [gqlOp]: "test" },
            chainId: { _eq: 1 },
          },
        }),
      );
    });
  });
});
