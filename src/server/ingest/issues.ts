export type IssueSeverity = "error" | "warning" | "info";

/** A problem found in imported data. Errors block a commit; warnings are shown for review. */
export type Issue = {
  severity: IssueSeverity;
  code: string;
  entity: string;
  /** "file.csv:line" for row-level issues. */
  rowRef?: string;
  field?: string;
  message: string;
};

export class IssueLog {
  readonly issues: Issue[] = [];

  add(issue: Issue): void {
    this.issues.push(issue);
  }

  error(code: string, entity: string, message: string, at: { rowRef?: string; field?: string } = {}): void {
    this.add({ severity: "error", code, entity, message, ...at });
  }

  warning(code: string, entity: string, message: string, at: { rowRef?: string; field?: string } = {}): void {
    this.add({ severity: "warning", code, entity, message, ...at });
  }

  get errorCount(): number {
    return this.issues.filter((issue) => issue.severity === "error").length;
  }

  /** Issue counts by code, for the import summary. */
  countsByCode(): Record<string, { severity: IssueSeverity; count: number }> {
    const counts: Record<string, { severity: IssueSeverity; count: number }> = {};
    for (const issue of this.issues) {
      counts[issue.code] ??= { severity: issue.severity, count: 0 };
      counts[issue.code].count += 1;
    }
    return counts;
  }
}
