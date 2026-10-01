import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import { z } from 'zod';
import { createProductionUserPrincipal } from './production-identity.js';
import { createProductionControlledIdentity } from './controlled-identity.js';
import { createProductionUserProvisioner } from './user-identity-provisioning.js';
import { ownFinancialRecords } from './financial-records.js';

export function registerProductionIdentityRoutes(app: FastifyInstance, db: PrismaClient, env: Record<string,string|undefined>,
  modes: { auth: { mode: string }; phone: { mode: string } }, demo: boolean) {
  if (env.FEATURE_V11_IDENTITY !== undefined && !['true','false'].includes(env.FEATURE_V11_IDENTITY))
    throw Error('FEATURE_V11_IDENTITY must be true or false');
  if(env.FEATURE_V11_FINANCIAL_RECORDS!==undefined&&!['true','false'].includes(env.FEATURE_V11_FINANCIAL_RECORDS))throw Error('FEATURE_V11_FINANCIAL_RECORDS must be true or false');
  const financialRecordsEnabled=env.FEATURE_V11_FINANCIAL_RECORDS==='true';
  if(financialRecordsEnabled&&env.FEATURE_V11_IDENTITY!=='true')throw Error('Financial records require formal identity');
  app.get('/api/v11/identity/capabilities', async()=>({version:'v11-identity-1',identityEnabled:env.FEATURE_V11_IDENTITY==='true',businessReady:false,financialRecordsEnabled}));
  if (env.FEATURE_V11_IDENTITY !== 'true') return;
  if (demo || modes.auth.mode !== 'wechat' || modes.phone.mode !== 'wechat')
    throw Error('Formal V1.1 identity routes require real identity providers and demo disabled');
  const user = createProductionUserPrincipal(db);
  const controlled = createProductionControlledIdentity(db, env.V11_CONTROLLED_ACCOUNTS_JSON);
  const provision = createProductionUserProvisioner(db);
  const response = (principal: unknown) => ({ version: 'v11-identity-1', principal });
  app.get('/api/v11/identity', async req => response(await user(req)));
  if(financialRecordsEnabled)app.get('/api/v11/registrations/:id/funds',async req=>{
    const actor=await user(req);const {id}=z.object({id:z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/)}).strict().parse(req.params);
    z.object({}).strict().parse(req.query);
    return ownFinancialRecords(db,actor,id);
  });
  app.post('/api/v11/identity/initialize', async req => {
    z.object({}).strict().parse(req.body);
    return response(await provision(req));
  });
  app.post('/api/v11/ops/login', async req => ({version:'v11-identity-1', ...await controlled.login(req)}));
  app.get('/api/v11/ops/identity', async req => response(await controlled.authenticate(req)));
}
