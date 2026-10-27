const STYLES: Record<string, string> = {
  committed: "border-forest bg-forest text-canvas",
  validated: "border-forest text-forest",
  staged: "border-mist text-graphite",
  rejected: "border-terracotta text-terracotta",
  failed: "border-terracotta bg-terracotta text-canvas"
};

const LABELS: Record<string, string> = {
  committed: "Imported",
  validated: "Ready to import",
  staged: "Staged",
  rejected: "Needs fixes",
  failed: "Failed — nothing saved"
};

export function StatusChip({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${STYLES[status] ?? "border-mist text-graphite"}`}>
      {LABELS[status] ?? status}
    </span>
  );
}
