import type { UploadedFile } from "@/server/ingest/parse";

/**
 * Amazon Selling Partner API, Finances v0: reads settled payouts (financial event groups) and
 * their events, and writes them in the Settlement Report V2 layout. The existing settlement
 * converter then applies the same fee mapping and the same check that every payout's lines add
 * up to its deposit, so a live sync and a downloaded report are treated identically.
 *
 * NOT VERIFIED AGAINST A REAL SELLER ACCOUNT. Endpoints, paging and field names follow Amazon's
 * published Finances v0 reference; tests use a simulated API. Credentials come only from
 * environment variables and are never stored in the database or logged.
 *
 *   AMAZON_SP_CLIENT_ID, AMAZON_SP_CLIENT_SECRET, AMAZON_SP_REFRESH_TOKEN   (required)
 *   AMAZON_SP_ENDPOINT   default https://sellingpartnerapi-eu.amazon.com (Amazon.in is in the EU region)
 *   AMAZON_SP_TOKEN_URL  default https://api.amazon.com/auth/o2/token
 */

export class AmazonApiError extends Error {}

type Env = Record<string, string | undefined>;
type Money = { CurrencyCode?: string; CurrencyAmount?: number };
type Charge = { ChargeType?: string; ChargeAmount?: Money };
type Fee = { FeeType?: string; FeeAmount?: Money };
type Withheld = { TaxesWithheld?: Charge[] };
type ShipmentItem = { SellerSKU?: string; QuantityShipped?: number; ItemChargeList?: Charge[]; ItemChargeAdjustmentList?: Charge[]; ItemFeeList?: Fee[]; ItemFeeAdjustmentList?: Fee[]; ItemTaxWithheldList?: Withheld[]; PromotionList?: { PromotionAmount?: Money; PromotionType?: string }[]; PromotionAdjustmentList?: { PromotionAmount?: Money; PromotionType?: string }[] };
type ShipmentEvent = { AmazonOrderId?: string; PostedDate?: string; ShipmentItemList?: ShipmentItem[]; ShipmentItemAdjustmentList?: ShipmentItem[]; ShipmentFeeList?: Fee[]; OrderFeeList?: Fee[] };
export type FinancialEvents = {
  ShipmentEventList?: ShipmentEvent[];
  RefundEventList?: ShipmentEvent[];
  ServiceFeeEventList?: { AmazonOrderId?: string; FeeList?: Fee[]; FeeDescription?: string }[];
  AdjustmentEventList?: { AdjustmentType?: string; PostedDate?: string; AdjustmentAmount?: Money }[];
  [other: string]: unknown;
};
export type EventGroup = {
  FinancialEventGroupId: string;
  ProcessingStatus?: string;
  FundTransferStatus?: string;
  FundTransferDate?: string;
  FinancialEventGroupStart?: string;
  FinancialEventGroupEnd?: string;
  OriginalTotal?: Money;
};

const HANDLED_LISTS = new Set(["ShipmentEventList", "RefundEventList", "ServiceFeeEventList", "AdjustmentEventList"]);

export function amazonConfigured(env: Env = process.env) {
  return Boolean(env.AMAZON_SP_CLIENT_ID && env.AMAZON_SP_CLIENT_SECRET && env.AMAZON_SP_REFRESH_TOKEN);
}

export class SpApiClient {
  private accessToken: { value: string; expires: number } | null = null;
  private readonly endpoint: string;

  constructor(
    private readonly env: Env = process.env,
    private readonly options: { fetchImpl?: typeof fetch; minIntervalMs?: number; maxRetries?: number } = {}
  ) {
    if (!amazonConfigured(env)) throw new AmazonApiError("Amazon is not connected: set AMAZON_SP_CLIENT_ID, AMAZON_SP_CLIENT_SECRET and AMAZON_SP_REFRESH_TOKEN");
    this.endpoint = (env.AMAZON_SP_ENDPOINT || "https://sellingpartnerapi-eu.amazon.com").replace(/\/+$/, "");
  }

  private get fetch() {
    return this.options.fetchImpl ?? fetch;
  }

  /** Login with Amazon: exchanges the refresh token for an access token (valid about an hour). */
  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expires > Date.now() + 60_000) return this.accessToken.value;
    const response = await this.fetch(this.env.AMAZON_SP_TOKEN_URL || "https://api.amazon.com/auth/o2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.env.AMAZON_SP_REFRESH_TOKEN!, client_id: this.env.AMAZON_SP_CLIENT_ID!, client_secret: this.env.AMAZON_SP_CLIENT_SECRET! }).toString()
    });
    const body = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    // Never echo the response body: it could contain token material.
    if (!response.ok || !body.access_token) throw new AmazonApiError(`Amazon refused the login (HTTP ${response.status}${body.error ? `, ${body.error}` : ""}). Check the app's client id, secret and refresh token.`);
    this.accessToken = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  private lastCall = 0;

  /** GET with Amazon's Finances rate limit (about one call every 2 s) and retries on 429/5xx. */
  async get<T>(path: string, query: Record<string, string>): Promise<T> {
    const url = `${this.endpoint}${path}?${new URLSearchParams(query).toString()}`;
    const maxRetries = this.options.maxRetries ?? 4;
    for (let attempt = 0; ; attempt += 1) {
      const wait = this.lastCall + (this.options.minIntervalMs ?? 2_100) - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCall = Date.now();
      const response = await this.fetch(url, { headers: { "x-amz-access-token": await this.token(), accept: "application/json" } });
      if (response.ok) return ((await response.json()) as { payload: T }).payload;
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, Math.min(30_000, (this.options.minIntervalMs ?? 2_100) * 2 ** attempt)));
        continue;
      }
      const body = (await response.json().catch(() => ({}))) as { errors?: { code?: string; message?: string }[] };
      const reason = body.errors?.map((e) => `${e.code ?? ""} ${e.message ?? ""}`.trim()).join("; ");
      throw new AmazonApiError(`Amazon answered HTTP ${response.status}${reason ? `: ${reason.slice(0, 300)}` : ""}`);
    }
  }

  /** Payout groups that started in [from, to]. */
  async eventGroups(from: string, to: string): Promise<EventGroup[]> {
    const out: EventGroup[] = [];
    let next: string | undefined;
    do {
      const query: Record<string, string> = next ? { NextToken: next } : { FinancialEventGroupStartedAfter: `${from}T00:00:00Z`, FinancialEventGroupStartedBefore: `${to}T23:59:59Z`, MaxResultsPerPage: "100" };
      const page = await this.get<{ FinancialEventGroupList?: EventGroup[]; NextToken?: string }>("/finances/v0/financialEventGroups", query);
      out.push(...(page.FinancialEventGroupList ?? []));
      next = page.NextToken;
    } while (next);
    return out;
  }

  /** Every event of one payout group, all pages merged. */
  async groupEvents(groupId: string): Promise<FinancialEvents> {
    const merged: FinancialEvents = {};
    let next: string | undefined;
    do {
      const page = await this.get<{ FinancialEvents?: FinancialEvents; NextToken?: string }>(`/finances/v0/financialEventGroups/${encodeURIComponent(groupId)}/financialEvents`, next ? { NextToken: next } : { MaxResultsPerPage: "100" });
      for (const [list, events] of Object.entries(page.FinancialEvents ?? {})) {
        if (Array.isArray(events)) (merged as Record<string, unknown[]>)[list] = [...(((merged as Record<string, unknown[]>)[list] as unknown[]) ?? []), ...events];
      }
      next = page.NextToken;
    } while (next);
    return merged;
  }
}

/** India date (YYYY-MM-DD) of an API timestamp. */
const istDate = (iso: string | undefined) => (iso ? new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10) : "");
const amount = (m: Money | undefined) => (m?.CurrencyAmount ?? 0).toFixed(2);

const V2_HEADER = ["settlement-id", "settlement-start-date", "settlement-end-date", "deposit-date", "total-amount", "currency", "transaction-type", "order-id", "amount-type", "amount-description", "amount", "posted-date"];

/**
 * Closed payout groups and their events as a Settlement Report V2 table (tab-separated). Event
 * lists this function does not know are reported back; their money is then missing from the
 * rows, so the deposit check fails loudly rather than the import silently losing it.
 */
export function eventsToSettlementFile(groups: { group: EventGroup; events: FinancialEvents }[]): { file: UploadedFile; unhandled: string[]; skippedOpen: number } {
  const lines: string[][] = [V2_HEADER];
  const unhandled = new Set<string>();
  let skippedOpen = 0;
  const row = (id: string, type: string, order: string, amountType: string, description: string, value: string, posted: string) =>
    lines.push([id, "", "", "", "", "", type, order, amountType, description, value, posted]);

  for (const { group, events } of groups) {
    const id = group.FinancialEventGroupId;
    // Only payouts Amazon has closed and transferred have a deposit to reconcile against.
    if (group.ProcessingStatus !== "Closed" || !group.FundTransferDate) {
      skippedOpen += 1;
      continue;
    }
    lines.push([id, istDate(group.FinancialEventGroupStart), istDate(group.FinancialEventGroupEnd), istDate(group.FundTransferDate), amount(group.OriginalTotal), group.OriginalTotal?.CurrencyCode ?? "INR", "", "", "", "", "", ""]);
    const items = (type: "Order" | "Refund", event: ShipmentEvent) => {
      const order = event.AmazonOrderId ?? "";
      const posted = istDate(event.PostedDate);
      for (const item of [...(event.ShipmentItemList ?? []), ...(event.ShipmentItemAdjustmentList ?? [])]) {
        for (const c of [...(item.ItemChargeList ?? []), ...(item.ItemChargeAdjustmentList ?? [])]) row(id, type, order, "ItemPrice", c.ChargeType ?? "Charge", amount(c.ChargeAmount), posted);
        for (const p of [...(item.PromotionList ?? []), ...(item.PromotionAdjustmentList ?? [])]) row(id, type, order, "Promotion", p.PromotionType ?? "Promotion", amount(p.PromotionAmount), posted);
        for (const f of [...(item.ItemFeeList ?? []), ...(item.ItemFeeAdjustmentList ?? [])]) row(id, type, order, "ItemFees", f.FeeType ?? "Fee", amount(f.FeeAmount), posted);
        for (const w of item.ItemTaxWithheldList ?? []) for (const t of w.TaxesWithheld ?? []) row(id, type, order, "ItemWithheldTax", t.ChargeType ?? "TCS", amount(t.ChargeAmount), posted);
      }
      for (const f of [...(event.ShipmentFeeList ?? []), ...(event.OrderFeeList ?? [])]) row(id, type, order, "ItemFees", f.FeeType ?? "Fee", amount(f.FeeAmount), posted);
    };
    for (const e of events.ShipmentEventList ?? []) items("Order", e);
    for (const e of events.RefundEventList ?? []) items("Refund", e);
    for (const e of events.ServiceFeeEventList ?? []) for (const f of e.FeeList ?? []) row(id, "ServiceFee", e.AmazonOrderId ?? "", "other-transaction", f.FeeType ?? e.FeeDescription ?? "ServiceFee", amount(f.FeeAmount), "");
    for (const e of events.AdjustmentEventList ?? []) row(id, "Adjustment", "", "other-transaction", e.AdjustmentType ?? "Adjustment", amount(e.AdjustmentAmount), istDate(e.PostedDate));
    for (const [list, value] of Object.entries(events)) if (!HANDLED_LISTS.has(list) && Array.isArray(value) && value.length > 0) unhandled.add(list);
  }
  const text = lines.map((l) => l.map((c) => c.replace(/[\t\r\n]/g, " ")).join("\t")).join("\n") + "\n";
  return { file: { name: "amazon-sp-api-settlements.txt", content: Buffer.from(text) }, unhandled: [...unhandled], skippedOpen };
}
