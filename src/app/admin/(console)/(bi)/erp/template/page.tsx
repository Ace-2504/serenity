import { TEMPLATE_DOCS } from "@/server/ingest/template-docs";

export default function TemplatePage() {
  return (
    <div className="space-y-6">
      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h2 className="font-display text-2xl">Import template</h2>
        <p className="mt-2 max-w-3xl text-sm text-graphite">
          Export these files from your accounting software (or prepare them in a spreadsheet and save as CSV). Amounts are in rupees with up to two decimals and exclude GST unless the
          column says otherwise; dates are YYYY-MM-DD. Every import is checked row by row and reconciled against the control totals before anything is saved.
        </p>
      </section>
      {TEMPLATE_DOCS.map((doc) => (
        <section key={doc.file} className="rounded-xl2 border border-mist bg-canvas p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-mono text-lg font-semibold">
              {doc.file} <span className="font-body text-sm font-normal text-graphite">{doc.required ? "required" : "optional"}</span>
            </h3>
            <a href={`/api/bi/template/${doc.file}`} className="rounded-full border border-ink px-4 py-1.5 text-sm font-semibold hover:bg-paper">
              Download example
            </a>
          </div>
          <p className="mt-1 text-sm text-graphite">{doc.purpose}</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <caption className="sr-only">Columns of {doc.file}</caption>
              <thead className="text-xs uppercase tracking-wide text-graphite">
                <tr>
                  <th className="py-2 pr-3">Column</th>
                  <th className="py-2 pr-3">Required</th>
                  <th className="py-2">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {doc.columns.map((c) => (
                  <tr key={c.column} className="border-t border-mist-light align-top">
                    <td className="py-2 pr-3 font-mono text-xs">{c.column}</td>
                    <td className="py-2 pr-3">{c.required ? "yes" : ""}</td>
                    <td className="py-2">{c.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
