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
      mockRequest.mockResolvedValue({ result: [] });

      await client.fetchEvents(
        {
          type: "event",
          event_type: "Supply",
          filters: [{ field: "testField", op: op as FilterOp, value: "test" }],
          field: "assets",
          aggregation: "sum",
        },
        0,
        1000,
      );

      expect(mockRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          result_where: {
            testField: { [gqlOp]: "test" },
            timestamp: { _gte: 0, _lte: 1 },
          },
        }),
      );
    });
  });
});
