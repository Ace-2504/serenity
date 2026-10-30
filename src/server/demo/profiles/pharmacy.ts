import type { DemoProfile } from "@/server/demo/profile";

const pad = (n: number, width = 3) => String(n).padStart(width, "0");

/**
 * Fictional retail chemist in Lucknow: counter sales to walk-in customers, regular patients on
 * chronic medicines, a few clinics and nursing homes on credit, and home-delivery orders paid
 * online. Stock is tracked by batch and expiry; retail lines are billed at MRP (tax-inclusive).
 *
 * ILLUSTRATIVE ASSUMPTIONS, NOT FACTS: the schedule assigned to each product group, GST rates and
 * HSN codes, shelf lives, margins, discounts off MRP, the gateway fee and every quantity. The
 * medicine names are generic molecule names with fictional brands. Schedule assignments here are
 * for synthetic data only and are not regulatory advice (see docs/platform/08-domain-packs.md).
 */
export const pharmacyDemoProfile: DemoProfile = {
  packId: "pharmacy",
  company: "Sanjeevani Medicos (DEMO - fictional business)",
  start: "2024-10-01",
  end: "2026-09-30",
  cities: [
    { name: "Lucknow", stateCode: "09" },
    { name: "Barabanki", stateCode: "09" },
    { name: "Unnao", stateCode: "09" },
    { name: "Sitapur", stateCode: "09" }
  ],
  brands: ["Nirogam", "Aushadhi", "Swasthya", "Jeevika", "Medirang", "Arogyan"],
  groups: [
    {
      name: "Acute prescription (Schedule H)",
      codePrefix: "RXA",
      count: 40,
      hsnCode: "3004",
      gstPct: 12,
      costPaise: [2500, 18000],
      markup: [0.08, 0.15],
      nouns: ["Amoxicillin 500 mg Capsules", "Azithromycin 500 mg Tablets", "Cefixime 200 mg Tablets", "Pantoprazole 40 mg Tablets", "Ondansetron 4 mg Tablets", "Montelukast 10 mg Tablets"],
      variants: ["Strip of 10", "Strip of 6", "Strip of 15"],
      segmentTag: "rx",
      attributes: { productClass: "medicine", schedule: "H" },
      shelfLifeDays: [540, 900]
    },
    {
      name: "Chronic care (Schedule H)",
      codePrefix: "RXC",
      count: 40,
      hsnCode: "3004",
      gstPct: 12,
      costPaise: [1500, 12000],
      markup: [0.08, 0.15],
      nouns: ["Metformin 500 mg Tablets", "Amlodipine 5 mg Tablets", "Telmisartan 40 mg Tablets", "Atorvastatin 10 mg Tablets", "Glimepiride 1 mg Tablets", "Levothyroxine 50 mcg Tablets"],
      variants: ["Strip of 10", "Strip of 15", "Strip of 30"],
      segmentTag: "chronic",
      attributes: { productClass: "medicine", schedule: "H" },
      shelfLifeDays: [540, 900]
    },
    {
      name: "OTC medicines",
      codePrefix: "OTC",
      count: 30,
      hsnCode: "3004",
      gstPct: 12,
      costPaise: [1500, 9000],
      markup: [0.1, 0.18],
      nouns: ["ORS Sachets", "Antacid Gel 170 ml", "Antiseptic Liquid 100 ml", "Pain Relief Balm 25 g", "Cough Lozenges", "Saline Nasal Spray"],
      variants: ["Pack of 1", "Pack of 3", "Family Pack"],
      segmentTag: "otc",
      attributes: { productClass: "medicine", schedule: "otc" },
      shelfLifeDays: [540, 1080]
    },
    {
      name: "Wellness & nutrition",
      codePrefix: "WEL",
      count: 25,
      hsnCode: "2106",
      gstPct: 18,
      costPaise: [9000, 60000],
      markup: [0.12, 0.25],
      nouns: ["Multivitamin Tablets", "Protein Powder 500 g", "Vitamin D3 Sachets", "Calcium Tablets", "Diabetic Nutrition 400 g"],
      variants: ["30 count", "60 count", "Chocolate", "Vanilla"],
      segmentTag: "wellness",
      attributes: { productClass: "wellness" },
      shelfLifeDays: [360, 720]
    },
    {
      name: "Personal care",
      codePrefix: "PCR",
      count: 20,
      hsnCode: "3304",
      gstPct: 18,
      costPaise: [5000, 35000],
      markup: [0.15, 0.3],
      nouns: ["Baby Lotion 200 ml", "Sunscreen SPF 50", "Hand Sanitiser 500 ml", "Antiseptic Soap", "Moisturising Cream"],
      variants: ["Regular", "Large", "Pack of 3"],
      segmentTag: "personal_care",
      attributes: { productClass: "personal_care" },
      shelfLifeDays: [720, 1080]
    },
    {
      name: "Medical devices",
      codePrefix: "DEV",
      count: 15,
      hsnCode: "9018",
      gstPct: 12,
      costPaise: [12000, 180000],
      markup: [0.12, 0.25],
      nouns: ["Digital Thermometer", "Glucometer Test Strips 50", "BP Monitor", "Pulse Oximeter", "Nebuliser"],
      variants: ["Standard", "Pro", "Compact"],
      segmentTag: "device",
      attributes: { productClass: "device" },
      shelfLifeDays: [540, 1440]
    }
  ],
  retailFactor: 1.18,
  platformDiscountPct: 0,
  priceRevision: { month: 4, pct: 3 },
  costInflationPctPerYear: 4,
  channels: [
    { id: "counter", label: "Shop counter", orderCharges: [], returnCharges: [], taxWithheld: null },
    { id: "direct", label: "Clinics (credit)", orderCharges: [], returnCharges: [], taxWithheld: null },
    {
      id: "own_web",
      label: "Home delivery (paid online)",
      orderCharges: [{ chargeType: "payment_gateway_fee", basis: "pct_of_order", value: 2, gstPct: 18 }],
      returnCharges: [],
      taxWithheld: null
    }
  ],
  segments: [
    {
      id: "walk_in",
      label: "Walk-in customers",
      channel: "counter",
      count: 1,
      codePrefix: "CASH",
      name: () => "Counter Sales (Cash)",
      billing: "cash",
      priceTier: "retail",
      anonymousBuyers: true,
      ordersPerWeek: [140, 140],
      seasonBoost: { "Monsoon infections": 1.35, "Winter cold & flu": 1.25 },
      offSeasonFactor: 1,
      groupWeights: { "Acute prescription (Schedule H)": 4, "OTC medicines": 4, "Wellness & nutrition": 1.2, "Personal care": 1.5, "Medical devices": 0.4, "Chronic care (Schedule H)": 1 },
      linesPerOrder: [1, 3],
      qty: [1, 3],
      qtyStep: 1,
      sizeSigma: 0,
      discountPct: [0, 0],
      creditDays: 0,
      payDelayMean: [0, 0],
      returnRate: 0,
      hasContact: false
    },
    {
      id: "patient",
      label: "Regular patients",
      channel: "counter",
      count: 220,
      codePrefix: "PAT",
      name: (n, city) => `Demo Patient ${pad(n)}, ${city}`,
      billing: "cash",
      priceTier: "retail",
      anonymousBuyers: false,
      // Roughly monthly refills.
      ordersPerWeek: [0.18, 0.3],
      seasonBoost: { "Winter cold & flu": 1.1 },
      offSeasonFactor: 1,
      groupWeights: { "Chronic care (Schedule H)": 7, "OTC medicines": 1, "Wellness & nutrition": 1, "Medical devices": 0.6 },
      linesPerOrder: [1, 3],
      qty: [1, 3],
      qtyStep: 1,
      sizeSigma: 0.3,
      discountPct: [5, 12],
      creditDays: 0,
      payDelayMean: [0, 0],
      returnRate: 0.005,
      hasContact: true
    },
    {
      id: "home_delivery",
      label: "Home-delivery customers",
      channel: "own_web",
      count: 300,
      codePrefix: "WEB",
      name: (n) => `Delivery Customer ${pad(n, 4)}`,
      billing: "prepaid",
      priceTier: "retail",
      anonymousBuyers: false,
      ordersPerWeek: [0.02, 0.08],
      seasonBoost: { "Monsoon infections": 1.3, "Winter cold & flu": 1.3 },
      offSeasonFactor: 1,
      groupWeights: { "Chronic care (Schedule H)": 3, "Wellness & nutrition": 2, "OTC medicines": 2, "Personal care": 2, "Medical devices": 1 },
      linesPerOrder: [1, 4],
      qty: [1, 3],
      qtyStep: 1,
      sizeSigma: 0.2,
      discountPct: [5, 10],
      creditDays: 0,
      payDelayMean: [0, 0],
      returnRate: 0.01,
      hasContact: true
    },
    {
      id: "clinic",
      label: "Clinics and nursing homes",
      channel: "direct",
      count: 25,
      codePrefix: "CLN",
      name: (n, city) => `Demo Clinic ${pad(n)}, ${city}`,
      billing: "credit",
      priceTier: "wholesale",
      anonymousBuyers: false,
      ordersPerWeek: [0.3, 0.8],
      seasonBoost: { "Monsoon infections": 1.4, "Winter cold & flu": 1.2 },
      offSeasonFactor: 1,
      groupWeights: { "Acute prescription (Schedule H)": 4, "OTC medicines": 2, "Medical devices": 2, "Personal care": 1 },
      linesPerOrder: [2, 6],
      qty: [10, 60],
      qtyStep: 5,
      sizeSigma: 0.4,
      discountPct: [0, 3],
      creditDays: 30,
      payDelayMean: [0, 12],
      returnRate: 0.01,
      hasContact: true
    }
  ],
  suppliers: { count: 8, leadDays: [1, 3], creditDays: [15, 21, 30], tradeDiscountPct: [0, 2] },
  inventory: { coverDays: 21, reorderSafety: 1.2, openingCoverDays: 35, caseSize: 10 },
  batches: { ageAtArrivalDays: [30, 150], mrpRoundPaise: 50 },
  retailPricesIncludeTax: true,
  plant: {
    slowMovers: { groups: ["Wellness & nutrition", "Medical devices"], count: 5, bulkBuyOn: "2025-10-10", stopSellingFrom: "2025-11-01", bulkQty: [60, 160] },
    lapsingKeyCustomers: { segment: "patient", count: 4, stopFrom: "2026-06-15" },
    // Not used by this trade: no customers stop at a season boundary.
    schoolsNotReordering: { segment: "clinic", count: 0, orderedBetween: ["2025-03-01", "2025-06-30"], stopFrom: "2026-01-01" },
    marginErosion: {
      group: "Chronic care (Schedule H)",
      costIncreasePct: 10,
      from: "2026-01-01",
      extraDiscountPct: 3,
      discountFrom: "2026-04-01",
      discountSegment: "patient"
    },
    slowPayers: { segment: "clinic", count: 5, from: "2026-03-01", extraDelayDays: [30, 60] },
    stockoutItems: { groups: ["Chronic care (Schedule H)"], count: 2, reorderSafety: 0.5, coverDays: 3 },
    missingOpeningValue: { count: 2 },
    shortDated: { groups: ["OTC medicines", "Wellness & nutrition", "Acute prescription (Schedule H)"], count: 6, buyOn: "2026-07-20", qty: [150, 400], lifeLeftDays: [90, 150] },
    expiredOpening: { groups: ["Acute prescription (Schedule H)", "Personal care"], count: 4, lifeLeftDays: [120, 240], coverMultiple: 12 }
  }
};
