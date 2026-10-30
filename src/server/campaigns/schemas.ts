import { z } from "zod";
import { AUDIENCES } from "@/server/campaigns/service";

export const audienceSchema = z.object({
  source: z.enum(Object.keys(AUDIENCES) as [keyof typeof AUDIENCES, ...(keyof typeof AUDIENCES)[]]),
  itemId: z.string().uuid().optional(),
  segment: z.enum(["champion", "loyal", "new", "at_risk", "lapsing", "inactive", "steady"]).optional(),
  maxScore: z.number().min(0.05).max(0.9).optional()
});
