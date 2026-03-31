import { describe, expect, it } from "vitest";
import { buildSignalTemplateCatalogResponse } from "../../src/api/catalog.ts";

describe("buildSignalTemplateCatalogResponse", () => {
  it("separates basic and advanced raw-event templates", () => {
    const response = buildSignalTemplateCatalogResponse();

    expect(response.basic.raw_events.map((template) => template.kind)).toEqual(
      expect.arrayContaining([
        "erc20_transfer",
        "erc721_transfer",
        "erc4626_deposit",
        "erc4626_withdraw",
        "swap",
      ]),
    );
    expect(response.advanced.raw_events.map((template) => template.kind)).toEqual([
      "contract_event",
    ]);
  });

  it("includes default authoring hints for ERC4626 templates", () => {
    const response = buildSignalTemplateCatalogResponse();
    const deposit = response.basic.raw_events.find(
      (template) => template.kind === "erc4626_deposit",
    );
    const withdraw = response.basic.raw_events.find(
      (template) => template.kind === "erc4626_withdraw",
    );

    expect(deposit).toMatchObject({ defaultAggregation: "sum", defaultField: "assets" });
    expect(withdraw).toMatchObject({ defaultAggregation: "sum", defaultField: "assets" });
  });
});
