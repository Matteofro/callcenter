import { z } from "zod";

/**
 * Date range filter shared by every /api/reports/* endpoint.
 *
 * - `from` defaults to 30 days ago
 * - `to` defaults to "now"
 * - Both accept ISO date strings (YYYY-MM-DD) or full ISO timestamps
 * - The window is capped at 365 days to protect the DB from accidentally
 *   exporting the entire history in one shot.
 */
const dateLike = z
  .string()
  .min(1)
  .transform((v, ctx) => {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Data non valida" });
      return z.NEVER;
    }
    return d;
  });

export const reportRangeSchema = z
  .object({
    from: dateLike.optional(),
    to: dateLike.optional(),
  })
  .transform((v) => {
    const to = v.to ?? new Date();
    const from = v.from ?? new Date(to.getTime() - 30 * 86_400_000);
    return { from, to };
  })
  .refine((v) => v.to.getTime() >= v.from.getTime(), {
    message: "La data di fine deve essere successiva alla data di inizio.",
  })
  .refine((v) => v.to.getTime() - v.from.getTime() <= 365 * 86_400_000, {
    message: "L'intervallo massimo è 365 giorni.",
  });

export type ReportRange = z.infer<typeof reportRangeSchema>;
