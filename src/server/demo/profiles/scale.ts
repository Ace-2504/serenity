import type { DemoProfile } from "@/server/demo/profile";

/** A smaller version of a profile: same channels, plants and rules, fewer days, items and customers. */
export function scaledProfile(profile: DemoProfile, options: { end: string; maxItemsPerGroup: number; maxPartiesPerSegment: number }): DemoProfile {
  return {
    ...profile,
    end: options.end,
    groups: profile.groups.map((g) => ({ ...g, count: Math.min(g.count, options.maxItemsPerGroup) })),
    segments: profile.segments.map((s) => ({ ...s, count: Math.min(s.count, options.maxPartiesPerSegment) }))
  };
}
