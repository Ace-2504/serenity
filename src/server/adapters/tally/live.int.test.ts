import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tallyToTemplate } from "@/server/adapters/tally/convert";
import { TallyConnectionError } from "@/server/adapters/tally/live";
import { enqueueDueTallySyncs, syncTally } from "@/server/adapters/tally/sync";
import { forTenant } from "@/server/db/tenant";
import { commitImport } from "@/server/ingest/pipeline";

/**
 * The live connector against a SIMULATED TallyPrime: an HTTP server that answers the three
 * requests with the fixture exports (UTF-16 with control-character junk, as Tally sends them).
 * This tests our side of the conversation, not Tally's.
 */

const COMPANY = "Fixture Traders (fictional)";
const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name));
const utf16 = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text.replace("<BODY>", "<BODY>&#4;"), "utf16le")]);
const requests: string[] = [];
let server: Server;
let url: string;
let tenantId: string;
let db: ReturnType<typeof forTenant>;
let sourceId: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push(body);
      res.setHeader("content-type", "text/xml; charset=utf-16");
      if (body.includes("SerenityCompanies")) {
        res.end(utf16(`<ENVELOPE><BODY><DATA><COLLECTION><COMPANY NAME="${COMPANY}"><BOOKSFROM>20250301</BOOKSFROM></COMPANY></COLLECTION></DATA></BODY></ENVELOPE>`));
      } else if (body.includes("List of Accounts")) {
        res.end(utf16(fixture("masters.xml").toString("utf8")));
      } else if (body.includes("<SVFROMDATE>20250401</SVFROMDATE>")) {
        res.end(utf16(fixture("daybook.xml").toString("utf8")));
      } else {
        // A month with no vouchers.
        res.end(utf16("<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDATA></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  tenantId = (await prisma.tenant.create({ data: { name: "Tally live test", domainPack: "stationery" } })).id;
  db = forTenant(tenantId);
  sourceId = (await db.dataSource.create({ data: { tenantId, kind: "tally_http", name: "TallyPrime (live sync)", settings: { url, company: COMPANY, autoCommit: false, dailySync: false } } })).id;
});

afterAll(async () => {
  server.close();
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("live Tally sync (simulated TallyPrime)", () => {
  it("reads masters and the Day Book month by month from the books' start, and stages them for review", async () => {
    const result = await syncTally(db, tenantId, sourceId, { to: "2025-04-30" });
    expect(result).toMatchObject({ status: "validated", committed: false, errors: 0, from: "2025-03-01", to: "2025-04-30", requests: 4 });
    const dayBooks = requests.filter((r) => r.includes("Day Book"));
    expect(dayBooks.map((r) => /<SVFROMDATE>(\d+)/.exec(r)![1])).toEqual(["20250301", "20250401"]);
    expect(dayBooks.every((r) => r.includes(`<SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY>`))).toBe(true);
  });

  it("produces exactly what a file upload of the same exports produces", async () => {
    const batch = await db.importBatch.findFirstOrThrow({ where: { dataSourceId: sourceId }, orderBy: { createdAt: "desc" } });
    await commitImport(db, tenantId, batch.id);
    const viaFiles = tallyToTemplate([{ name: "masters.xml", content: fixture("masters.xml") }, { name: "daybook.xml", content: fixture("daybook.xml") }]);
    const imported = Object.values(viaFiles.summary.imported).reduce((s, n) => s + n, 0);
    expect(await db.voucher.count({ where: { dataSourceId: sourceId, type: { not: "opening_stock" } } })).toBe(imported);
  });

  it("changes nothing when Tally has not changed", async () => {
    const result = await syncTally(db, tenantId, sourceId, { to: "2025-04-30" });
    expect(result.status).toBe("duplicate");
    expect((await db.dataSource.findUniqueOrThrow({ where: { id: sourceId } })).lastSuccessfulSyncAt).not.toBeNull();
  });

  it("says which companies are open when the configured one is not", async () => {
    await db.dataSource.update({ where: { id: sourceId }, data: { settings: { url, company: "Other Co", autoCommit: false, dailySync: false } } });
    await expect(syncTally(db, tenantId, sourceId, { to: "2025-04-30" })).rejects.toThrow(new RegExp(`Open companies: ${COMPANY.replace(/[()]/g, "\\$&")}`));
    await db.dataSource.update({ where: { id: sourceId }, data: { settings: { url, company: COMPANY, autoCommit: false, dailySync: false } } });
  });

  it("explains a Tally that is not running", async () => {
    await db.dataSource.update({ where: { id: sourceId }, data: { settings: { url: "http://127.0.0.1:1", company: COMPANY, autoCommit: false, dailySync: false } } });
    await expect(syncTally(db, tenantId, sourceId, { to: "2025-04-30" })).rejects.toBeInstanceOf(TallyConnectionError);
    await db.dataSource.update({ where: { id: sourceId }, data: { settings: { url, company: COMPANY, autoCommit: false, dailySync: false } } });
  });

  it("queues daily syncs only for sources set to sync daily and not synced in the last day", async () => {
    const queued = async () => prisma.job.count({ where: { tenantId, type: "tally.sync", status: "queued" } });
    await enqueueDueTallySyncs();
    expect(await queued()).toBe(0);
    await db.dataSource.update({ where: { id: sourceId }, data: { settings: { url, company: COMPANY, autoCommit: true, dailySync: true }, lastSuccessfulSyncAt: new Date(Date.now() - 2 * 86_400_000) } });
    await enqueueDueTallySyncs();
    await enqueueDueTallySyncs();
    expect(await queued()).toBe(1);
  });
});
