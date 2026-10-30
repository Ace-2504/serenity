"use client";

import { useRouter } from "next/navigation";

export function BusinessSwitcher({ active, options }: { active: string; options: { tenantId: string; name: string; isDemo: boolean }[] }) {
  const router = useRouter();
  if (options.length < 2) return null;
  return (
    <label className="flex min-w-0 max-w-full items-center gap-2 text-sm">
      <span className="text-graphite">Business</span>
      <select
        value={active}
        onChange={async (event) => {
          await fetch("/api/bi/active", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: event.target.value }) });
          router.refresh();
        }}
        className="min-w-0 max-w-[13rem] truncate rounded-full border border-mist bg-canvas px-3 py-1 sm:max-w-xs"
      >
        {options.map((o) => (
          <option key={o.tenantId} value={o.tenantId}>
            {o.name}
            {o.isDemo ? " (demo)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
