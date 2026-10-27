import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { getServerSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** The questions the reports answer, each shown with a screen from the demo business. */
const QUESTIONS = [
  {
    question: "Which products make money once marketplace fees are paid?",
    detail: "Profit by product, group and channel: Amazon's closing and shipping fees, Meesho's shipping, gateway fees and quick-commerce prices are taken off before you see a margin.",
    image: "/product/profitability.jpg",
    alt: "Profitability report of the demo stationery distributor"
  },
  {
    question: "Where is my cash stuck?",
    detail: "Who owes you, how late they are, what you owe suppliers, and how many days your money spends in stock and in customers' hands.",
    image: "/product/cash.jpg",
    alt: "Receivables and cash cycle of the demo business"
  },
  {
    question: "What should I look at first this week?",
    detail: "Fixed rules read your books and list problems in order of rupee impact, each with its evidence and how you will know if acting on it worked.",
    image: "/product/overview.jpg",
    alt: "Overview page listing findings for the demo business"
  },
  {
    question: "Which batches will expire before they sell?",
    detail: "For chemists: stock by batch and expiry, sold earliest-expiry first, and what to return to the distributor while you still can.",
    image: "/product/pharmacy-expiry.jpg",
    alt: "Expiry view of the demo pharmacy"
  }
];

const SOURCES = [
  ["TallyPrime", "Day Book and masters as XML, or a live sync over Tally's server on your network"],
  ["BUSY or any spreadsheet", "Sales and purchase registers in Excel or CSV, with a column mapping you confirm once"],
  ["Amazon.in and Meesho", "Settlement reports and payment exports, or Amazon's API for payouts"],
  ["Blinkit, Zepto, Instamart", "Purchase orders and GRNs, for fill rate"]
];

export default function HomePage() {
  const session = getServerSession();
  const start = (session ? "/bi" : "/signup") as Route;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 md:px-8">
      <section className="grid items-center gap-10 py-14 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:py-20">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-forest">For Indian businesses on Tally or BUSY</p>
          <h1 className="mt-3 text-balance font-display text-4xl leading-[1.08] text-ink md:text-6xl">Your books already know where the money went.</h1>
          <p className="mt-5 max-w-xl text-lg text-graphite">
            Serenity BI reads your accounts, marketplace payouts and quick-commerce orders, checks them against your own totals, and shows profit after fees, cash
            stuck in stock and customers, and what to act on first.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href={start} className="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-canvas hover:bg-forest">
              {session ? "Open your reports" : "Create your account"}
            </Link>
            <Link href={(session ? "/bi/imports" : "/signup?demo=1") as Route} className="rounded-full border border-ink px-6 py-3 text-sm font-semibold text-ink hover:bg-paper">
              Try it with demo data
            </Link>
          </div>
          <p className="mt-4 text-sm text-graphite">The demo is a fictional distributor or chemist with two years of generated books. Nothing you see in it is a real business.</p>
        </div>
        <figure className="min-w-0">
          <div className="overflow-hidden rounded-xl2 border border-mist bg-canvas shadow-panel">
            <Image src="/product/overview.jpg" alt="Serenity BI overview of the demo stationery distributor" width={1280} height={800} priority className="h-auto w-full" />
          </div>
          <figcaption className="mt-2 text-xs text-graphite">Overview of the demo business, Kalamkaar Distributors (fictional).</figcaption>
        </figure>
      </section>

      <section aria-labelledby="questions" className="border-t border-mist py-14">
        <h2 id="questions" className="text-balance font-display text-3xl text-ink md:text-4xl">
          Answers to the questions owners ask
        </h2>
        <div className="mt-10 grid gap-12">
          {QUESTIONS.map((q, i) => (
            <article key={q.question} className={`grid items-center gap-6 md:grid-cols-2 ${i % 2 ? "md:[&>*:first-child]:order-2" : ""}`}>
              <div className="min-w-0">
                <h3 className="text-balance font-display text-2xl text-ink">{q.question}</h3>
                <p className="mt-3 max-w-prose text-graphite">{q.detail}</p>
              </div>
              <div className="min-w-0 overflow-hidden rounded-xl2 border border-mist bg-canvas">
                <Image src={q.image} alt={q.alt} width={1280} height={800} className="h-auto w-full" />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="how" className="border-t border-mist py-14">
        <h2 id="how" className="font-display text-3xl text-ink md:text-4xl">
          How it works
        </h2>
        <ol className="mt-8 grid gap-6 md:grid-cols-3">
          <li className="min-w-0">
            <p className="font-display text-4xl text-forest">1</p>
            <h3 className="mt-1 text-lg font-semibold text-ink">Bring in your books</h3>
            <ul className="mt-3 space-y-2 text-sm text-graphite">
              {SOURCES.map(([name, how]) => (
                <li key={name}>
                  <span className="font-semibold text-ink">{name}:</span> {how}
                </li>
              ))}
            </ul>
          </li>
          <li className="min-w-0">
            <p className="font-display text-4xl text-forest">2</p>
            <h3 className="mt-1 text-lg font-semibold text-ink">Check before saving</h3>
            <p className="mt-3 text-sm text-graphite">
              Every import is checked line by line and must add up to the totals from your own registers before anything is saved. You see each problem with the row
              it came from. Re-importing the same period changes only what changed.
            </p>
          </li>
          <li className="min-w-0">
            <p className="font-display text-4xl text-forest">3</p>
            <h3 className="mt-1 text-lg font-semibold text-ink">Decide, then measure</h3>
            <p className="mt-3 text-sm text-graphite">
              Each finding shows what happened, the evidence and the rupee impact. You decide what to do; Serenity checks the numbers afterwards to show whether it
              worked. Campaigns to customers go out only after you approve the audience, the message and the send.
            </p>
          </li>
        </ol>
      </section>

      <section aria-labelledby="trust" className="border-t border-mist py-14">
        <h2 id="trust" className="font-display text-3xl text-ink md:text-4xl">
          Your data stays yours
        </h2>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <p className="text-graphite">
            Each business&apos;s data is kept apart in the database itself, not only by the application. Nothing goes to an outside service unless you switch it on:
            the assistant uses only a model server the operator runs, and customer emails wait in an outbox until an email server is set up.
          </p>
          <p className="text-graphite">
            Numbers you see come from your books by fixed formulas, published on the Definitions page. Predictions are tested against simple rules and used only when
            they do better. The assistant may only repeat numbers from the reports; any other number is withheld.
          </p>
        </div>
        <p className="mt-6 max-w-3xl rounded-xl border border-mustard bg-mustard/15 px-4 py-3 text-sm text-ink">
          Serenity BI is new. The Tally, BUSY, Amazon, Meesho and quick-commerce importers have been tested on sample files, not yet on many real businesses&apos;
          exports, so compare your first import with your own registers. <Link href="/privacy" className="font-semibold underline">How your data is handled</Link>.
        </p>
      </section>

      <section className="border-t border-mist py-14 text-center">
        <h2 className="text-balance font-display text-3xl text-ink md:text-4xl">See it on a demo business first</h2>
        <p className="mx-auto mt-3 max-w-xl text-graphite">Create an account, open the demo stationery distributor or chemist, and look around. Your own books come in when you are ready.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href={start} className="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-canvas hover:bg-forest">
            {session ? "Open your reports" : "Create your account"}
          </Link>
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-mist pt-6 text-sm text-graphite">
        <p>Serenity BI</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-4">
          <Link href="/privacy" className="hover:text-ink">
            Your data
          </Link>
          <Link href="/shop" className="hover:text-ink">
            Paper Serenity shop
          </Link>
        </nav>
      </footer>
    </main>
  );
}
