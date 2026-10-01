import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import { z } from 'zod';
import { createProductionUserPrincipal } from './production-identity.js';
import { createProductionControlledPrincipal } from './controlled-identity.js';
import { createProductionUserProvisioner } from './user-identity-provisioning.js';

export function registerProductionIdentityRoutes(app: FastifyInstance, db: PrismaClient, env: Record<string,string|undefined>,
  modes: { auth: { mode: string }; phone: { mode: string } }, demo: boolean) {
  if (env.FEATURE_V11_IDENTITY !== undefined && !['true','false'].includes(env.FEATURE_V11_IDENTITY))
    throw Error('FEATURE_V11_IDENTITY must be true or false');
  if (env.FEATURE_V11_IDENTITY !== 'true') return;
  if (demo || modes.auth.mode !== 'wechat' || modes.phone.mode !== 'wechat')
    throw Error('Formal V1.1 identity routes require real identity providers and demo disabled');
  const user = createProductionUserPrincipal(db);
  const controlled = createProductionControlledPrincipal(db, env.V11_CONTROLLED_IDENTITY_BINDINGS_JSON);
  const provision = createProductionUserProvisioner(db);
  const response = (principal: unknown) => ({ version: 'v11-identity-1', principal });
  app.get('/api/v11/identity', async req => response(await user(req)));
  app.post('/api/v11/identity/initialize', async req => {
    z.object({}).strict().parse(req.body);
    return response(await provision(req));
  });
  app.get('/api/v11/ops/identity', async req => response(await controlled(req)));
}
