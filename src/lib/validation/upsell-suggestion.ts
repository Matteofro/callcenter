import { z } from "zod";
import { UpsellKind } from "@prisma/client";

const SKU = z
  .string()
  .trim()
  .min(1, "SKU obbligatorio")
  .max(64, "SKU troppo lungo (max 64)")
  .regex(/^[A-Za-z0-9._-]+$/, "Il SKU può contenere solo lettere, numeri, '.', '_', '-'");

export const upsellSuggestionCreateSchema = z.object({
  triggerSku: SKU,
  suggestSku: SKU,
  kind: z.nativeEnum(UpsellKind).default("RELATED"),
  priority: z.coerce.number().int().min(0).max(100).default(0),
  discountCents: z.coerce.number().int().min(0).max(1_000_000).default(0),
  active: z.coerce.boolean().default(true),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const upsellSuggestionUpdateSchema = upsellSuggestionCreateSchema.partial();

export type UpsellSuggestionCreateInput = z.infer<typeof upsellSuggestionCreateSchema>;
export type UpsellSuggestionUpdateInput = z.infer<typeof upsellSuggestionUpdateSchema>;
