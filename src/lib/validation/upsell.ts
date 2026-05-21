import { z } from "zod";
import { UpsellOutcomeStatus } from "@prisma/client";

export const upsellOutcomeSchema = z.object({
  callId: z.string().uuid(),
  orderId: z.string().uuid(),
  suggestedSku: z.string().trim().min(1).max(64),
  outcome: z.nativeEnum(UpsellOutcomeStatus),
  extraValueCents: z.number().int().min(0).max(10_000_000).default(0),
  notes: z.string().trim().max(1000).optional(),
});
