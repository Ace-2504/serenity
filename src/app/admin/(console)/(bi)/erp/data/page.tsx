import Link from "next/link";

export const metadata = { title: "How data is handled · Owner console" };

/** What the software stores and sends, as built. Not a legal document. */
export default function PrivacyPage() {
  return (
    <div className="max-w-3xl">
      <h2 className="font-display text-3xl text-ink">How data is handled</h2>
      <p className="mt-4 rounded-xl border border-mustard bg-mustard/15 px-4 py-3 text-sm">
        This page describes what the software does, as built. It has not been reviewed by a lawyer and is not yet a privacy policy or terms of service, for example
        under India&apos;s Digital Personal Data Protection Act, 2023. Do not upload other people&apos;s personal data until those documents exist for the service you
        use.
      </p>

      <div className="mt-8 space-y-8 text-graphite [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-ink [&_li]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
        <section>
          <h2>What is stored</h2>
          <ul>
            <li>Accounts: name, email and a salted hash of the password (never the password itself), for staff and for shop customers.</li>
            <li>
              The shop&apos;s own records: products, stock, orders and payments. When the website is linked to a business, its orders, customers and products are
              also copied into that business&apos;s books.
            </li>
            <li>
              What you import into a business: ledgers, vouchers, items, batches, stock, and the parties in your books, which can include customers&apos; names, phone
              numbers, email addresses and GSTINs. The original files are kept as source records so every number can be traced back.
            </li>
            <li>What the software works out from them: reports, findings, predictions, and the campaigns and messages you approve.</li>
            <li>Two cookies: one keeps you signed in for up to 7 days, the other remembers which business you last opened in the console. There are no advertising or analytics cookies.</li>
          </ul>
        </section>

        <section>
          <h2>Who can see it</h2>
          <ul>
            <li>In the console: the shop&apos;s staff by role, and each business&apos;s members (owner, accountant or analyst). Shop customers see only their own account and orders.</li>
            <li>
              Each business&apos;s data is kept apart by the application and, for background work, by the database&apos;s row-level security, so one business cannot read
              another&apos;s.
            </li>
            <li>Whoever runs the server and its database (on the hosted service, its operator and hosting providers) can technically read the database.</li>
          </ul>
        </section>

        <section>
          <h2>What leaves the server</h2>
          <ul>
            <li>Nothing goes to an outside service by default.</li>
            <li>Customer emails go out only after the owner approves a campaign, and only if an email server is configured; otherwise they wait in an outbox.</li>
            <li>The assistant uses a model server the operator runs. A model outside the server is refused unless the operator explicitly allows it.</li>
            <li>Amazon payouts are read from Amazon only if the operator sets up Amazon credentials. Live Tally sync reads from Tally on your own network.</li>
          </ul>
        </section>

        <section>
          <h2>Customers&apos; consent</h2>
          <p>
            A campaign reaches only customers recorded as having agreed to that kind of message on that channel. Shop customers are asked when they create their
            account, and the box is unticked by default. Every email carries an unsubscribe link that works without signing in.
          </p>
        </section>

        <section>
          <h2>Deleting your data</h2>
          <p>
            The owner can delete a business, with everything imported into it, from the <Link href="/admin/erp/business" className="underline">Business</Link> page. It cannot
            be undone. Copies in server backups remain until those backups expire. Deleting an account from the app is not built yet; ask the operator.
          </p>
        </section>
      </div>
    </div>
  );
}
