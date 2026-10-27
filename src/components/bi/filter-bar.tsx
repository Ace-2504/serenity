import type { PeriodPreset } from "@/server/analytics/period";

type Option = { value: string; label: string };

/** One row of filters above the charts; a plain GET form so it works without JavaScript. */
export function FilterBar({
  action,
  preset,
  from,
  to,
  channels,
  groups,
  values
}: {
  action: string;
  preset: PeriodPreset;
  from: string;
  to: string;
  channels?: Option[];
  groups?: Option[];
  values?: { channel?: string; group?: string; q?: string };
}) {
  const field = "rounded-full border border-mist bg-canvas px-3 py-1.5 text-sm";
  return (
    <form action={action} method="get" className="mb-6 flex flex-wrap items-end gap-2 rounded-xl2 border border-mist bg-canvas p-3">
      <label className="flex flex-col text-xs text-graphite">
        Period
        <select name="period" defaultValue={preset} className={field}>
          <option value="last12">Last 12 months</option>
          <option value="fy">This financial year</option>
          <option value="prevfy">Last financial year</option>
          <option value="all">All data</option>
          <option value="custom">Custom (dates below)</option>
        </select>
      </label>
      <label className="flex flex-col text-xs text-graphite">
        From
        <input type="date" name="from" defaultValue={from} className={field} />
      </label>
      <label className="flex flex-col text-xs text-graphite">
        To
        <input type="date" name="to" defaultValue={to} className={field} />
      </label>
      {channels && (
        <label className="flex flex-col text-xs text-graphite">
          Channel
          <select name="channel" defaultValue={values?.channel ?? ""} className={field}>
            <option value="">All channels</option>
            {channels.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {groups && (
        <label className="flex flex-col text-xs text-graphite">
          Group
          <select name="group" defaultValue={values?.group ?? ""} className={field}>
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {values && "q" in values && (
        <label className="flex flex-col text-xs text-graphite">
          Search
          <input type="search" name="q" defaultValue={values.q ?? ""} placeholder="Product name or code" className={field} />
        </label>
      )}
      <button type="submit" className="rounded-full border border-ink bg-ink px-4 py-1.5 text-sm font-semibold text-canvas hover:bg-forest">
        Apply
      </button>
    </form>
  );
}
