import { z } from "zod";
import { CallStatus } from "@prisma/client";

export const createCallSchema = z.object({
  customerId: z.string().uuid(),
  orderId: z.string().uuid().optional(),
  status: z.nativeEnum(CallStatus).optional(),
});

export const updateCallStatusSchema = z.object({
  status: z.nativeEnum(CallStatus),
  outcomeReason: z.string().trim().max(120).optional(),
  followUpAt: z.coerce.date().optional(),
  endedAt: z.coerce.date().optional(),
});

export const createCallNoteSchema = z.object({
  body: z.string().trim().min(1, "La nota non può essere vuota").max(2000),
});
