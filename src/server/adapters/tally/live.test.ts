import { describe, expect, it } from "vitest";
import { checkTallyUrl, dayBookRequest, isLanHost, monthChunks, TallyClient, TallyConnectionError } from "@/server/adapters/tally/live";

describe("live Tally connector", () => {
  it("splits a period into calendar months", () => {
    expect(monthChunks("2025-03-15", "2025-05-02")).toEqual([
      { from: "2025-03-15", to: "2025-03-31" },
      { from: "2025-04-01", to: "2025-04-30" },
      { from: "2025-05-01", to: "2025-05-02" }
    ]);
  });

  it("escapes the company name and sends Tally's date format", () => {
    const xml = dayBookRequest("Shah & Sons <Delhi>", "2025-04-01", "2025-04-30");
    expect(xml).toContain("<SVCURRENTCOMPANY>Shah &amp; Sons &lt;Delhi&gt;</SVCURRENTCOMPANY>");
    expect(xml).toContain("<SVFROMDATE>20250401</SVFROMDATE>");
  });

  it("only talks to Tally on this machine or the office network, unless the operator allows more", () => {
    for (const host of ["localhost", "127.0.0.1", "192.168.1.20", "10.0.0.5", "172.20.1.1", "TALLY-PC", "tally.local"]) expect(isLanHost(host), host).toBe(true);
    for (const host of ["8.8.8.8", "example.com", "169.254.169.254", "172.40.1.1"]) expect(isLanHost(host), host).toBe(false);
    expect(() => checkTallyUrl("http://tally.example.com:9000")).toThrow(TallyConnectionError);
    expect(() => checkTallyUrl("http://tally.example.com:9000", { TALLY_ALLOW_REMOTE: "1" })).not.toThrow();
    expect(() => checkTallyUrl("ftp://localhost:9000")).toThrow(/http/);
    expect(() => checkTallyUrl("http://user:pw@localhost:9000")).toThrow(/user name/);
  });

  it("reports Tally's own error message", async () => {
    const fetchImpl = (async () => new Response("<ENVELOPE><BODY><DATA><LINEERROR>Could not find Company 'X'</LINEERROR></DATA></BODY></ENVELOPE>")) as unknown as typeof fetch;
    const client = new TallyClient({ url: "http://localhost:9000", company: "X" }, { fetchImpl });
    await expect(client.dayBook("2025-04-01", "2025-04-30")).rejects.toThrow(/Could not find Company 'X'/);
  });
});
