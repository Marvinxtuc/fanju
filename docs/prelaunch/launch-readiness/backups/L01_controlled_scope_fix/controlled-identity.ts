import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import { z } from 'zod';
import { requireOps } from '../auth.js';
import { identifier, reject, type LocalPrincipal } from './contracts.js';
import { resolveVerifiedIdentity } from './principal.js';

const bindingSchema = z.object({
  adminId: identifier, accountVersion: z.string().min(1).max(80), actorId: identifier,
  personId: identifier, actorVersion: z.number().int().nonnegative(),
  role: z.enum(['OPS', 'REVIEWER', 'RESTAURANT']), restaurantId: identifier.nullable(),
}).strict().superRefine((row, ctx) => {
  if ((row.role === 'RESTAURANT') !== (row.restaurantId !== null))
    ctx.addIssue({ code: 'custom', message: 'Restaurant binding mismatch' });
});
export type ControlledIdentityBinding = z.infer<typeof bindingSchema>;
export function parseControlledIdentityBindings(value: string | undefined): readonly ControlledIdentityBinding[] {
  if (!value) return [];
  try {
    const rows = z.array(bindingSchema).max(100).parse(JSON.parse(value));
    // One login maps to one explicit role; no role selection from request data.
    if (new Set(rows.map(x => x.adminId)).size !== rows.length
        || new Set(rows.map(x => x.actorId)).size !== rows.length) throw Error();
    return Object.freeze(rows.map(x => Object.freeze(x)));
  } catch { throw Error('Invalid controlled V1.1 identity configuration'); }
}

export function createProductionControlledPrincipal(db: PrismaClient, configuredBindings: string | undefined) {
  const bindings = parseControlledIdentityBindings(configuredBindings);
  return async (request: FastifyRequest): Promise<LocalPrincipal> => {
    const session = await requireOps(request).catch((error: unknown) => {
      const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
      if (status === 401 || status === 403) reject(status, status === 401 ? 'SESSION_EXPIRED' : 'FORBIDDEN');
      throw error;
    });
    const binding = bindings.find(x => x.adminId === session.sub);
    if (!binding || binding.accountVersion !== session.accountVersion) reject(403, 'IDENTITY_BINDING_UNAVAILABLE');
    return resolveVerifiedIdentity({ actorId: binding.actorId, personId: binding.personId, role: binding.role,
      actorVersion: binding.actorVersion, userId: null, restaurantId: binding.restaurantId },
      id => db.v11Actor.findUnique({ where: { id } }));
  };
}
