import type { TenantDb } from "@/server/db/tenant";
import { getDomainPack } from "@/domain/packs";

/** Names for ids used across analytics pages, loaded once per request. */
export async function lookups(db: TenantDb, domainPack: string) {
  const [items, groups, channels] = await Promise.all([
    db.item.findMany({ select: { id: true, sourceKey: true, name: true, itemGroupId: true } }),
    db.itemGroup.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.voucher.findMany({ where: { type: "sales_invoice", status: "active" }, distinct: ["channel"], select: { channel: true } })
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  return {
    items: new Map(items.map((i) => [i.id, { code: i.sourceKey, name: i.name, group: i.itemGroupId ? (groupName.get(i.itemGroupId) ?? "—") : "—", groupId: i.itemGroupId }])),
    groups,
    channels: channels.map((c) => c.channel ?? "direct").sort(),
    pack: getDomainPack(domainPack)
  };
}

export const CHANNEL_LABELS: Record<string, string> = {
  direct: "Direct B2B",
  counter: "Shop counter",
  own_web: "Own website",
  amazon: "Amazon",
  meesho: "Meesho",
  blinkit: "Blinkit",
  zepto: "Zepto",
  instamart: "Swiggy Instamart"
};
export const channelLabel = (id: string) => CHANNEL_LABELS[id] ?? id;
