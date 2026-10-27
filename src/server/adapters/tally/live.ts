import { decodeTallyXml } from "@/server/adapters/tally/decode";
import { collectTallyObjects, nameOf, text, TallyXmlError } from "@/server/adapters/tally/collect";
import { tallyToTemplate, type TallyConversion } from "@/server/adapters/tally/convert";
import { tallyDate } from "@/server/adapters/tally/values";
import type { UploadedFile } from "@/server/ingest/parse";

/**
 * Live TallyPrime sync over its XML-over-HTTP server (TallyPrime as server, default port 9000).
 * It asks Tally for the same two exports a person would make by hand: all masters, and the Day
 * Book month by month. Then it feeds them to the Tally XML adapter, so a live sync and a file
 * upload go through identical mapping and checks.
 *
 * NOT VERIFIED AGAINST A REAL TALLYPRIME. The request envelopes follow the documented
 * Export Data / Collection pattern and two open-source connectors (docs/platform/07-integration-
 * research.md). They are tested only against a simulated server that replays the fixture exports.
 */

export class TallyConnectionError extends Error {}

export type TallySettings = { url: string; company: string };

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const tallyDay = (iso: string) => iso.replace(/-/g, "");

/** Lists the companies open in Tally, with the date their books begin. */
export const companiesRequest = () => `<ENVELOPE>
 <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>SerenityCompanies</ID></HEADER>
 <BODY><DESC>
  <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE><COLLECTION NAME="SerenityCompanies" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME, BOOKSFROM, STARTINGFROM</FETCH></COLLECTION></TDLMESSAGE></TDL>
 </DESC></BODY>
</ENVELOPE>`;

/** Every master (groups, ledgers, stock items, units, voucher types), with closing balances as on `to`. */
export const mastersRequest = (company: string, to: string) => `<ENVELOPE>
 <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
 <BODY><EXPORTDATA><REQUESTDESC>
  <REPORTNAME>List of Accounts</REPORTNAME>
  <STATICVARIABLES>
   <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   <ACCOUNTTYPE>All Masters</ACCOUNTTYPE>
   <SVTODATE>${tallyDay(to)}</SVTODATE>
   <SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>
  </STATICVARIABLES>
 </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;

/** The Day Book (every voucher) for one date range. */
export const dayBookRequest = (company: string, from: string, to: string) => `<ENVELOPE>
 <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
 <BODY><EXPORTDATA><REQUESTDESC>
  <REPORTNAME>Day Book</REPORTNAME>
  <STATICVARIABLES>
   <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   <SVFROMDATE>${tallyDay(from)}</SVFROMDATE>
   <SVTODATE>${tallyDay(to)}</SVTODATE>
   <EXPLODEFLAG>Yes</EXPLODEFLAG>
   <SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>
  </STATICVARIABLES>
 </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;

/**
 * Live sync needs the app on the same network as Tally. A hosted copy (VERCEL=1) cannot reach an
 * office network, and its own private addresses are not the business's, so it is off there unless
 * the operator has secured a public Tally address (TALLY_ALLOW_REMOTE=1).
 */
export const liveTallyAvailable = (env: Record<string, string | undefined> = process.env) => env.VERCEL !== "1" || env.TALLY_ALLOW_REMOTE === "1";

/**
 * Tally runs on the business's own network, so only local and private addresses are accepted
 * unless the operator sets TALLY_ALLOW_REMOTE=1. This keeps the sync from being used to make the
 * server call arbitrary internet addresses.
 */
export function checkTallyUrl(raw: string, env: Record<string, string | undefined> = process.env): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TallyConnectionError("The Tally address is not a URL, e.g. http://192.168.1.20:9000");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TallyConnectionError("The Tally address must start with http:// or https://");
  if (url.username || url.password) throw new TallyConnectionError("The Tally address must not contain a user name or password");
  if (!liveTallyAvailable(env)) throw new TallyConnectionError("Live sync works when Serenity runs on a computer in your office. On the hosted service, export the Day Book from Tally and upload it instead.");
  if (!isLanHost(url.hostname) && env.TALLY_ALLOW_REMOTE !== "1") {
    throw new TallyConnectionError(`${url.hostname} is not on this machine or office network. Tally's server should not be reachable from the internet; set TALLY_ALLOW_REMOTE=1 only if you have secured it.`);
  }
  return url;
}

/**
 * localhost, private IPv4 ranges, single-label machine names (TALLY-PC) and .local/.lan/.internal
 * names. Link-local 169.254.x.x is excluded: it is where cloud metadata services live.
 */
export function isLanHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h === "::1" || h === "host.docker.internal") return true;
  if (/^(127|10)\.\d+\.\d+\.\d+$/.test(h) || /^192\.168\.\d+\.\d+$/.test(h) || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)) return true;
  if (/^[a-z0-9-]+$/.test(h) && !/^\d+$/.test(h)) return true;
  return /\.(local|lan|internal|home\.arpa)$/.test(h);
}

export class TallyClient {
  constructor(
    private readonly settings: TallySettings,
    private readonly options: { fetchImpl?: typeof fetch; timeoutMs?: number; env?: Record<string, string | undefined> } = {}
  ) {
    checkTallyUrl(settings.url, options.env);
  }

  async post(xml: string, label: string): Promise<Buffer> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(this.settings.url, {
        method: "POST",
        headers: { "content-type": "text/xml; charset=utf-8" },
        body: xml,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000)
      });
    } catch (error) {
      const timedOut = (error as Error).name === "TimeoutError";
      throw new TallyConnectionError(
        timedOut
          ? `Tally did not answer the ${label} request in time. Large companies may need a longer timeout; check that Tally is not busy.`
          : `Could not reach Tally at ${new URL(this.settings.url).host}. Check that TallyPrime is open with the company loaded and that its server (connectivity) is switched on.`
      );
    }
    if (!response.ok) throw new TallyConnectionError(`Tally answered the ${label} request with HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    // Tally reports request problems inside an otherwise successful response.
    const decoded = decodeTallyXml(body).text;
    const lineError = /<LINEERROR>([\s\S]*?)<\/LINEERROR>/i.exec(decoded);
    if (lineError) throw new TallyConnectionError(`Tally refused the ${label} request: ${lineError[1].trim().slice(0, 300)}`);
    return body;
  }

  async companies(): Promise<{ name: string; booksFrom: string | null }[]> {
    const body = await this.post(companiesRequest(), "company list");
    const objects = collectTallyObjects([{ name: "companies.xml", content: body }]);
    return objects.COMPANY.map((c) => ({ name: nameOf(c), booksFrom: tallyDate(text(c, "BOOKSFROM")) ?? tallyDate(text(c, "STARTINGFROM")) })).filter((c) => c.name);
  }

  async masters(to: string): Promise<Buffer> {
    return this.post(mastersRequest(this.settings.company, to), "masters");
  }

  async dayBook(from: string, to: string): Promise<Buffer> {
    return this.post(dayBookRequest(this.settings.company, from, to), "Day Book");
  }
}

/** Calendar months covering [from, to], each clipped to the range. */
export function monthChunks(from: string, to: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    out.push({ from: cursor.toISOString().slice(0, 10), to: (monthEnd < end ? monthEnd : end).toISOString().slice(0, 10) });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return out;
}

export type TallyFetch = { conversion: TallyConversion; files: UploadedFile[]; requests: number; from: string; to: string; company: string };

/**
 * Fetches masters and the Day Book for [from, to] and converts them. `from` defaults to the date
 * the company's books begin, so opening balances in the masters line up with the first voucher.
 */
export async function fetchFromTally(client: TallyClient, settings: TallySettings, range: { from?: string; to: string }, onStep?: (step: string) => void): Promise<TallyFetch> {
  onStep?.("tally_connect");
  const companies = await client.companies();
  const company = companies.find((c) => c.name === settings.company);
  if (!company) {
    throw new TallyConnectionError(
      companies.length ? `Company "${settings.company}" is not open in Tally. Open companies: ${companies.map((c) => c.name).join(", ")}` : "Tally answered, but no company is open in it"
    );
  }
  const from = range.from ?? company.booksFrom;
  if (!from) throw new TallyConnectionError("Tally did not say when this company's books begin; enter the start date yourself");
  if (from > range.to) throw new TallyConnectionError("The start date is after the end date");

  onStep?.("tally_masters");
  const files: UploadedFile[] = [{ name: "tally-masters.xml", content: await client.masters(range.to) }];
  let requests = 2;
  for (const chunk of monthChunks(from, range.to)) {
    onStep?.(`tally_daybook:${chunk.from.slice(0, 7)}`);
    files.push({ name: `tally-daybook-${chunk.from.slice(0, 7)}.xml`, content: await client.dayBook(chunk.from, chunk.to) });
    requests += 1;
  }
  let conversion: TallyConversion;
  try {
    conversion = tallyToTemplate(files);
  } catch (error) {
    if (error instanceof TallyXmlError) throw new TallyConnectionError(`Tally's answer could not be read: ${error.message}`);
    throw error;
  }
  return { conversion, files, requests, from, to: range.to, company: settings.company };
}
