/**
 * POST /api/calls/:id/notes
 * Append a note to a call. The author is the current session user.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, errors } from "@/lib/http";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { publish } from "@/lib/pubsub";
import { createCallNoteSchema } from "@/lib/validation/call";

const paramsSchema = z.object({ id: z.string().uuid() });

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireSession();
    const { id } = paramsSchema.parse(await ctx.params);
    const body = createCallNoteSchema.parse(await req.json());

    const call = await prisma.call.findUnique({ where: { id } });
    if (!call) throw errors.notFound("Chiamata");

    const note = await prisma.callNote.create({
      data: { callId: id, authorId: session.user.id, body: body.body },
    });

    await writeAudit({
      userId: session.user.id,
      action: "call.note_added",
      entityType: "Call",
      entityId: id,
      newValue: { noteId: note.id, preview: body.body.slice(0, 80) },
    });

    publish({
      type: "call.updated",
      entityId: id,
      related: { customerId: call.customerId, orderId: call.orderId ?? undefined },
    });

    return ok(note, { status: 201 });
  })();
}
