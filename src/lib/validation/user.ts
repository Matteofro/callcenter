import { z } from "zod";
import { UserRole, UserStatus } from "@prisma/client";

const PASSWORD_RULES = z
  .string()
  .min(10, "La password deve avere almeno 10 caratteri")
  .max(128, "La password è troppo lunga (max 128)")
  .regex(/[A-Z]/, "Deve contenere almeno una maiuscola")
  .regex(/[a-z]/, "Deve contenere almeno una minuscola")
  .regex(/[0-9]/, "Deve contenere almeno un numero");

export const userCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email non valida").max(120),
  fullName: z.string().trim().min(2, "Nome troppo corto").max(120),
  role: z.nativeEnum(UserRole).default("OPERATOR"),
  status: z.nativeEnum(UserStatus).default("ACTIVE"),
  password: PASSWORD_RULES,
});

export const userUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  role: z.nativeEnum(UserRole).optional(),
  status: z.nativeEnum(UserStatus).optional(),
  /** Se presente, resetta la password */
  password: PASSWORD_RULES.optional(),
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
