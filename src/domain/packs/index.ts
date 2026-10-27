import type { DomainPack } from "@/domain/types";
import { pharmacyPack } from "@/domain/packs/pharmacy";
import { stationeryPack } from "@/domain/packs/stationery";

const PACKS: Record<string, DomainPack> = {
  [stationeryPack.id]: stationeryPack,
  [pharmacyPack.id]: pharmacyPack
};

export function listDomainPacks(): DomainPack[] {
  return Object.values(PACKS);
}

export function getDomainPack(id: string): DomainPack {
  const pack = PACKS[id];
  if (!pack) {
    throw new Error(`Unknown domain pack "${id}"`);
  }

  return pack;
}

/** Packs a tenant can be created with. Planned packs are excluded until their milestone ships. */
export function getSelectableDomainPack(id: string): DomainPack {
  const pack = getDomainPack(id);
  if (pack.status !== "active") {
    throw new Error(`Domain pack "${id}" is planned and not yet available`);
  }

  return pack;
}
