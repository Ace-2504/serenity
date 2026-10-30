import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { MembershipRole } from "@prisma/client";
import { GET as getImport } from "@/app/api/bi/imports/[importId]/route";
import { POST as commit } from "@/app/api/bi/imports/[importId]/commit/route";
import { POST as upload } from "@/app/api/bi/imports/route";
import { POST as decide } from "@/app/api/bi/findings/[findingId]/route";
import { GET as getJob } from "@/app/api/bi/jobs/[jobId]/route";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ACTIVE_TENANT_COOKIE } from "@/server/bi/context";
import { TEMPLATE_EXAMPLES } from "@/server/ingest/template-docs";

const users: string[] = [];
const tenants: string[] = [];

async function user(storefrontRoles: ("owner_admin" | "customer")[] = []) {
  const created = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, passwordHash: "x" } });
  users.push(created.id);
  return { id: created.id, token: createSessionToken({ userId: created.id, email: created.email, roles: storefrontRoles }) };
}

async function business(members: { userId: string; role: MembershipRole }[], isDemo = false) {
  const tenant = await prisma.tenant.create({ data: { name: "API test", domainPack: "stationery", isDemo, memberships: { create: members } } });
  tenants.push(tenant.id);
  return tenant.id;
}

function request(url: string, opts: { token?: string; tenantId?: string; body?: FormData | string; method?: string } = {}) {
  const cookies = [opts.token && `${SESSION_COOKIE}=${opts.token}`, opts.tenantId && `${ACTIVE_TENANT_COOKIE}=${opts.tenantId}`].filter(Boolean).join("; ");
  return new NextRequest(new URL(url, "http://localhost"), { method: opts.method ?? "GET", headers: cookies ? { cookie: cookies } : {}, body: opts.body });
}

/** Waits for a background job to finish (the route starts it in-process). */
async function settled(jobId: string) {
  for (let i = 0; i < 600; i += 1) {
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    if (job.status === "done" || job.status === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`job ${jobId} did not finish`);
}

function templateForm(): FormData {
  const form = new FormData();
  for (const [name, text] of Object.entries(TEMPLATE_EXAMPLES)) form.append("files", new File([text], name, { type: "text/csv" }));
  return form;
}

let owner: Awaited<ReturnType<typeof user>>;
let analyst: Awaited<ReturnType<typeof user>>;
let outsider: Awaited<ReturnType<typeof user>>;
let realBusiness: string;

beforeAll(async () => {
  owner = await user(["owner_admin"]);
  analyst = await user();
  outsider = await user();
  realBusiness = await business([
    { userId: owner.id, role: "owner_admin" },
    { userId: analyst.id, role: "analyst" }
  ]);
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

describe("BI import API", () => {
  it("requires a session", async () => {
    const response = await upload(request("/api/bi/imports", { method: "POST", body: templateForm() }));
    expect(response.status).toBe(401);
  });

  it("requires membership of a business", async () => {
    const response = await upload(request("/api/bi/imports", { method: "POST", token: outsider.token, body: templateForm() }));
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("NO_BUSINESS");
  });

  it("does not let an analyst upload", async () => {
    const response = await upload(request("/api/bi/imports", { method: "POST", token: analyst.token, body: templateForm() }));
    expect(response.status).toBe(403);
  });

  it("refuses uploads into a demo business, so demo and real data never mix", async () => {
    const demo = await business([{ userId: owner.id, role: "owner_admin" }], true);
    const response = await upload(request("/api/bi/imports", { method: "POST", token: owner.token, tenantId: demo, body: templateForm() }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("DEMO_BUSINESS");
  });

  it("lets the owner stage and commit the template example; analysts can view but not commit", async () => {
    const staged = await upload(request("/api/bi/imports", { method: "POST", token: owner.token, tenantId: realBusiness, body: templateForm() }));
    expect(staged.status).toBe(201);
    const { batchId, status } = await staged.json();
    expect(status).toBe("validated");

    const view = await getImport(request(`/api/bi/imports/${batchId}`, { token: analyst.token, tenantId: realBusiness }), { params: { importId: batchId } });
    expect(view.status).toBe(200);
    const denied = await commit(request(`/api/bi/imports/${batchId}/commit`, { method: "POST", token: analyst.token, tenantId: realBusiness }), { params: { importId: batchId } });
    expect(denied.status).toBe(403);

    const committed = await commit(request(`/api/bi/imports/${batchId}/commit`, { method: "POST", token: owner.token, tenantId: realBusiness }), { params: { importId: batchId } });
    expect(committed.status).toBe(202);
    const { jobId } = await committed.json();
    // A second click while the job is queued or running returns the same job, not a second commit.
    const duplicate = await commit(request(`/api/bi/imports/${batchId}/commit`, { method: "POST", token: owner.token, tenantId: realBusiness }), { params: { importId: batchId } });
    if (duplicate.status === 202) expect((await duplicate.json()).jobId).toBe(jobId);
    else expect(duplicate.status).toBe(409);

    const job = await settled(jobId);
    expect(job.status, job.error ?? "").toBe("done");
    const result = job.result as { reconciliation: { ok: boolean }[]; findings: { produced: number } };
    expect(result.reconciliation.every((r) => r.ok)).toBe(true);
    expect(result.findings).toBeDefined();

    const polled = await getJob(request(`/api/bi/jobs/${jobId}`, { token: analyst.token, tenantId: realBusiness }), { params: { jobId } });
    expect((await polled.json()).status).toBe("done");

    const again = await commit(request(`/api/bi/imports/${batchId}/commit`, { method: "POST", token: owner.token, tenantId: realBusiness }), { params: { importId: batchId } });
    expect(again.status).toBe(409);
  });

  it("hides another business's jobs", async () => {
    const other = await business([{ userId: outsider.id, role: "owner_admin" }]);
    const job = await prisma.job.findFirstOrThrow({ where: { tenantId: realBusiness } });
    const response = await getJob(request(`/api/bi/jobs/${job.id}`, { token: outsider.token, tenantId: other }), { params: { jobId: job.id } });
    expect(response.status).toBe(404);
  });

  it("lets only the owner decide on a recommendation", async () => {
    const finding = await prisma.finding.create({
      data: { tenantId: realBusiness, ruleId: "TEST", dedupeKey: "TEST|1", entityType: "business", entityLabel: "x", severity: "low", asOf: new Date("2026-01-01"), title: "t", whatHappened: "w", whyItMatters: "y", suggestedAction: "a", evidence: { facts: [] }, measurePlan: { metric: "dso", baseline: 1, target: 1, checkAfterDays: 30, direction: "decrease" } }
    });
    const body = JSON.stringify({ action: "accept" });
    const denied = await decide(request(`/api/bi/findings/${finding.id}`, { method: "POST", token: analyst.token, tenantId: realBusiness, body }), { params: { findingId: finding.id } });
    expect(denied.status).toBe(403);
    const accepted = await decide(request(`/api/bi/findings/${finding.id}`, { method: "POST", token: owner.token, tenantId: realBusiness, body }), { params: { findingId: finding.id } });
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).measurePlan.checkOn).toBe("2026-01-31");
    const twice = await decide(request(`/api/bi/findings/${finding.id}`, { method: "POST", token: owner.token, tenantId: realBusiness, body }), { params: { findingId: finding.id } });
    expect(twice.status).toBe(409);
  });

  it("hides another business's imports", async () => {
    const other = await business([{ userId: outsider.id, role: "owner_admin" }]);
    const batch = await prisma.importBatch.findFirstOrThrow({ where: { tenantId: realBusiness } });
    const response = await getImport(request(`/api/bi/imports/${batch.id}`, { token: outsider.token, tenantId: other }), { params: { importId: batch.id } });
    expect(response.status).toBe(404);
  });
});
