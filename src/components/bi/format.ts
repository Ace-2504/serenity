const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2, minimumFractionDigits: 2 });
const count = new Intl.NumberFormat("en-IN");
const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

export const formatInr = (value: string | number) => inr.format(Number(value));
export const formatCount = (value: number) => count.format(value);
export const plural = (value: number, one: string, many: string) => `${count.format(value)} ${value === 1 ? one : many}`;
export const formatDate = (value: Date | string | null) => (value ? dateFmt.format(new Date(value)) : "—");
export const formatDateTime = (value: Date | string | null) => (value ? dateTimeFmt.format(new Date(value)) : "—");

export const METRIC_LABELS: Record<string, string> = {
  sales_taxable: "Sales (taxable value)",
  sales_tax: "GST on sales",
  sales_return_taxable: "Sales returns (taxable value)",
  purchase_taxable: "Purchases (taxable value)",
  purchase_return_taxable: "Purchase returns (taxable value)",
  receipts: "Receipts from customers",
  payments: "Payments to suppliers",
  channel_charges: "Marketplace & gateway charges"
};

export const ENTITY_LABELS: Record<string, string> = {
  party: "Customers & suppliers",
  item: "Items",
  opening_stock: "Opening stock",
  voucher: "Invoices & returns",
  settlement: "Receipts & payments",
  channel_charge: "Channel charges"
};
