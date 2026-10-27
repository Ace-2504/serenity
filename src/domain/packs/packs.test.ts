import { describe, expect, it } from "vitest";
import { getDomainPack, getSelectableDomainPack, listDomainPacks } from "@/domain/packs";

describe("domain pack registry", () => {
  it("registers every pack under its own id", () => {
    for (const pack of listDomainPacks()) {
      expect(getDomainPack(pack.id)).toBe(pack);
    }
  });

  it("rejects unknown packs", () => {
    expect(() => getDomainPack("bakery")).toThrow(/Unknown domain pack/);
  });

  it("does not allow selecting a planned pack for a tenant", () => {
    expect(getSelectableDomainPack("stationery").id).toBe("stationery");
    expect(() => getSelectableDomainPack("pharmacy")).toThrow(/planned/);
  });

  it("keeps thresholds internally consistent", () => {
    for (const pack of listDomainPacks()) {
      expect(pack.thresholds.deadStockDays).toBeGreaterThan(pack.thresholds.slowMovingDays);
      for (const season of pack.seasonality) {
        expect(season.months.every((m) => Number.isInteger(m) && m >= 1 && m <= 12)).toBe(true);
      }
    }
  });
});

describe("stationery pack", () => {
  const pack = getDomainPack("stationery");

  it("accepts known attributes and rejects unknown ones", () => {
    expect(pack.itemAttributes.safeParse({ brand: "Classmate", segment: "school" }).success).toBe(true);
    expect(pack.itemAttributes.safeParse({ expiry: "2027-01-01" }).success).toBe(false);
  });
});

describe("pharmacy pack", () => {
  const pack = getDomainPack("pharmacy");

  it("requires a schedule for medicines but not for devices", () => {
    expect(pack.itemAttributes.safeParse({ productClass: "medicine" }).success).toBe(false);
    expect(pack.itemAttributes.safeParse({ productClass: "medicine", schedule: "H" }).success).toBe(true);
    expect(pack.itemAttributes.safeParse({ productClass: "device" }).success).toBe(true);
  });

  it("blocks promotion of prescription medicines", () => {
    const verdict = pack.campaignPolicy.isPromotable({ productClass: "medicine", schedule: "H1" });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/H1/);
  });

  it("allows promotion of OTC medicines and wellness products", () => {
    expect(pack.campaignPolicy.isPromotable({ productClass: "medicine", schedule: "otc" }).allowed).toBe(true);
    expect(pack.campaignPolicy.isPromotable({ productClass: "wellness" }).allowed).toBe(true);
  });

  it("blocks promotion when attributes are invalid rather than guessing", () => {
    expect(pack.campaignPolicy.isPromotable({}).allowed).toBe(false);
  });

  it("requires batch tracking and tax-inclusive pricing by default", () => {
    expect(pack.batchTracking).toBe("required");
    expect(pack.pricesIncludeTax).toBe(true);
    expect(pack.thresholds.nearExpiryDays).toBeGreaterThan(0);
  });
});
