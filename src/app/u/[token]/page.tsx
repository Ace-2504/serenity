import { readUnsubscribeToken } from "@/server/campaigns/tokens";

export const dynamic = "force-dynamic";

/** Public unsubscribe page. GET only shows the button (link scanners must not unsubscribe people). */
export default function UnsubscribePage({ params, searchParams }: { params: { token: string }; searchParams: { done?: string } }) {
  const valid = readUnsubscribeToken(params.token) !== null;
  if (valid && searchParams.done === "1") {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="font-display text-3xl">You are unsubscribed</h1>
        <p className="mt-4 text-sm text-graphite">You will not receive these messages again.</p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="font-display text-3xl">Unsubscribe</h1>
      {valid ? (
        <form action={`/api/unsubscribe?token=${encodeURIComponent(params.token)}`} method="post" className="mt-6">
          <p className="text-sm text-graphite">Stop receiving these messages from this business.</p>
          <button type="submit" className="mt-4 rounded-full border border-ink bg-ink px-5 py-2 text-sm font-semibold text-canvas">
            Unsubscribe me
          </button>
        </form>
      ) : (
        <p className="mt-6 text-sm text-graphite">This link is not valid.</p>
      )}
    </main>
  );
}
