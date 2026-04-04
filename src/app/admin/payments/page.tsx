"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const razorpayEnabled = process.env.NEXT_PUBLIC_RAZORPAY_ENABLED === "true";

type Summary = {
  total: number;
  captured: number;
  failed: number;
  pending: number;
  mismatches: number;
};

type PaymentRow = {
  id: string;
  provider: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  status: string;
  amountInr: number;
  currency: string;
  failureCode: string | null;
  updatedAt: string;
  mismatch: boolean;
  order: {
    orderNumber: string;
    paymentStatus: string;
    status: string;
    grandTotalInr: number;
    paymentMethod: string;
  };
};

export default function AdminPaymentsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [mismatchOnly, setMismatchOnly] = useState(false);
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const [summaryRes, listRes] = await Promise.all([
      fetch("/api/admin/payments/summary", { cache: "no-store" }),
      fetch(`/api/admin/payments?${new URLSearchParams({
        ...(status !== "all" ? { status } : {}),
        ...(mismatchOnly ? { mismatch: "1" } : {})
      })}`, { cache: "no-store" })
    ]);

    if (!summaryRes.ok || !listRes.ok) {
      setError("Unable to load payment reconciliation data.");
      setLoading(false);
      return;
    }

    const summaryData = (await summaryRes.json()) as Summary;
    const listData = (await listRes.json()) as { items: PaymentRow[] };

    setSummary(summaryData);
    setPayments(listData.items);
    setLoading(false);
  }, [mismatchOnly, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reconcileNow() {
    setBusyId("reconcile");
    const response = await fetch("/api/admin/payments/reconcile", { method: "POST" });
    if (!response.ok) {
      setError("Reconciliation failed.");
      setBusyId(null);
      return;
    }

    await load();
    setBusyId(null);
  }

  async function retryPayment(paymentId: string) {
    setBusyId(paymentId);
    const response = await fetch(`/api/admin/payments/${paymentId}/retry`, { method: "POST" });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      setError(data.message ?? "Retry failed.");
      setBusyId(null);
      return;
    }

    await load();
    setBusyId(null);
  }

  return (
    <main className="min-h-screen w-full px-4 pb-16 pt-8 md:px-8 xl:px-12">
      <header className="reveal-in mb-6 flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-graphite">Owner Console</p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">Paper Serenity Stationery Hub</p>
          <h1 className="font-display text-4xl">Payment Reconciliation</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/admin" className="rounded-full border border-ink px-4 py-2 text-sm font-semibold hover:border-forest hover:bg-forest hover:text-canvas">
            Dashboard
          </Link>
          <button
            type="button"
            onClick={() => void reconcileNow()}
            disabled={!razorpayEnabled || busyId === "reconcile"}
            className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-canvas hover:bg-forest disabled:opacity-60"
          >
            {busyId === "reconcile" ? "Reconciling..." : "Reconcile Now"}
          </button>
        </div>
      </header>

      {!razorpayEnabled ? (
        <p className="mb-4 rounded-lg border border-mist bg-paper px-3 py-2 text-sm text-graphite">
          Razorpay is currently paused. Historical payment data stays visible here, but retry and reconciliation actions are disabled.
        </p>
      ) : null}

      {error ? <p className="mb-4 rounded-lg border border-terracotta bg-[#fce7e2] px-3 py-2 text-sm text-terracotta">{error}</p> : null}

      <section className="reveal-in reveal-delay-1 mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total" value={summary?.total ?? 0} />
        <StatCard label="Captured" value={summary?.captured ?? 0} />
        <StatCard label="Failed" value={summary?.failed ?? 0} />
        <StatCard label="Pending" value={summary?.pending ?? 0} />
        <StatCard label="Mismatches" value={summary?.mismatches ?? 0} danger={(summary?.mismatches ?? 0) > 0} />
      </section>

      <section className="reveal-in reveal-delay-2 mb-4 rounded-2xl border border-mist bg-gradient-to-br from-canvas to-mist-light/60 p-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span>Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="rounded-lg border border-mist bg-canvas px-2 py-1"
            >
              <option value="all">All</option>
              <option value="created">Created</option>
              <option value="authorized">Authorized</option>
              <option value="captured">Captured</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={mismatchOnly} onChange={(event) => setMismatchOnly(event.target.checked)} />
            Show mismatches only
          </label>
          <button type="button" onClick={() => void load()} className="rounded-full border border-ink px-3 py-1.5 font-semibold hover:border-forest hover:bg-forest hover:text-canvas">
            Refresh
          </button>
        </div>
      </section>

      <section className="reveal-in reveal-delay-3 rounded-2xl border border-mist bg-canvas p-5">
        <h2 className="mb-4 text-xl font-semibold">Recent Payments</h2>
        {loading ? <p className="text-sm text-graphite">Loading payment rows...</p> : null}

        {!loading ? (
          <div className="overflow-auto">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-mist text-graphite">
                  <th className="py-2">Order</th>
                  <th className="py-2">Provider</th>
                  <th className="py-2">Provider Order</th>
                  <th className="py-2">Payment Status</th>
                  <th className="py-2">Order Payment</th>
                  <th className="py-2">Amount</th>
                  <th className="py-2">Mismatch</th>
                  <th className="py-2">Updated</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-mist/60">
                    <td className="py-3 font-semibold">{payment.order.orderNumber}</td>
                    <td className="py-3">{payment.provider}</td>
                    <td className="py-3">{payment.providerOrderId ?? "-"}</td>
                    <td className="py-3 uppercase">{payment.status}</td>
                    <td className="py-3">{payment.order.paymentStatus}</td>
                    <td className="py-3">₹{payment.amountInr}</td>
                    <td className="py-3">
                      {payment.mismatch ? <span className="rounded-full bg-[#fce7e2] px-2 py-1 text-xs font-semibold text-terracotta">Yes</span> : "No"}
                    </td>
                    <td className="py-3">{new Date(payment.updatedAt).toLocaleString()}</td>
                    <td className="py-3">
                      {payment.status !== "captured" && payment.order.paymentMethod !== "cod" ? (
                        <button
                          type="button"
                          onClick={() => void retryPayment(payment.id)}
                          disabled={!razorpayEnabled || busyId === payment.id}
                          className="rounded-full border border-ink px-3 py-1.5 text-xs font-semibold hover:border-forest hover:bg-forest hover:text-canvas disabled:opacity-60"
                        >
                          {busyId === payment.id ? "Retrying..." : "Retry"}
                        </button>
                      ) : (
                        <span className="text-xs text-graphite">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function StatCard({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <article className="rounded-xl2 border border-mist bg-gradient-to-br from-canvas to-mist-light/60 p-4">
      <p className="text-xs uppercase tracking-wide text-graphite">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${danger ? "text-terracotta" : "text-ink"}`}>{value}</p>
    </article>
  );
}