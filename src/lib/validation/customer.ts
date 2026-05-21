import { z } from "zod";

export const customerSearchSchema = z.object({
  q: z.string().trim().min(2, "La query deve contenere almeno 2 caratteri").max(64),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const customerIdSchema = z.object({
  id: z.string().uuid("ID cliente non valido"),
});
