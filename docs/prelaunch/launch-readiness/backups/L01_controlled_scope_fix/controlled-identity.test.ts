import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import { registerAuth, signSession } from '../auth.js';
import { errorResponse } from './contracts.js';
import { createProductionControlledPrincipal, parseControlledIdentityBindings } from './controlled-identity.js';
const base={adminId:'admin',accountVersion:'v1',actorId:'actor',personId:'person',actorVersion:2,role:'OPS',restaurantId:null};
async function fixture(role='OPS',config:unknown=undefined) {
 const actor={id:'actor',personId:'person',version:2,role,userId:null,restaurantId:role==='RESTAURANT'?'restaurant':null,passwordHash:'unused-synthetic',enabled:true};
 const admin={id:'admin',username:'controlled',role:'OPS',updatedAt:new Date(0)};
 const db={adminUser:{findUnique:vi.fn().mockResolvedValue(admin)},v11Actor:{findUnique:vi.fn().mockResolvedValue(actor)}};
 const account={username:'controlled',role:'OPS',version:'v1',enabled:true,passwordHash:'scrypt:'+ 'a'.repeat(32)+':'+ 'a'.repeat(128)};
 const app=Fastify();await registerAuth(app,db as unknown as PrismaClient,{APP_ENV:'test',SESSION_SECRET:'synthetic-only-signing-secret-32-characters',OPS_ACCOUNTS_JSON:JSON.stringify([account])});
 const principal=createProductionControlledPrincipal(db as unknown as PrismaClient,JSON.stringify(config??[{...base,role,restaurantId:actor.restaurantId}]));
 app.setErrorHandler((e,_q,r)=>{if('statusCode'in e&&e.statusCode===401)return r.code(401).send({error:'UNAUTHORIZED'});const x=errorResponse(e);r.code(x.statusCode).send(x.body);});app.get('/identity',principal);
 const token=()=>signSession(app,{sub:'admin',role:'OPS',adminRevision:admin.updatedAt.toISOString(),accountVersion:'v1'});
 return{app,db,actor,admin,token};
}
describe('controlled formal role bindings',()=>{
 it.each(['OPS','REVIEWER','RESTAURANT'])('maps configured %s and ignores client privilege hints',async role=>{const f=await fixture(role);try{const r=await f.app.inject({url:'/identity?role=SUPER_ADMIN&restaurantId=other',headers:{authorization:'Bearer '+f.token()}});expect(r.statusCode).toBe(200);expect(r.json()).toMatchObject({id:'actor',role,personId:'person'});expect(r.json()).not.toHaveProperty('passwordHash');if(role==='RESTAURANT')expect(r.json().restaurantId).toBe('restaurant');}finally{await f.app.close();}});
 it('does not grant a role to an unconfigured admin',async()=>{const f=await fixture('OPS',[]);try{expect((await f.app.inject({url:'/identity',headers:{authorization:'Bearer '+f.token()}})).statusCode).toBe(403);expect(f.db.v11Actor.findUnique).not.toHaveBeenCalled();}finally{await f.app.close();}});
 it('rejects account binding version mismatch',async()=>{const f=await fixture('OPS',[{...base,accountVersion:'v2'}]);try{expect((await f.app.inject({url:'/identity',headers:{authorization:'Bearer '+f.token()}})).statusCode).toBe(403);}finally{await f.app.close();}});
 it.each(['role','personId','version','restaurantId','userId','enabled'])('revokes a changed actor %s',async field=>{const f=await fixture();try{Object.assign(f.actor,{[field]:field==='version'?3:field==='enabled'?false:'different'});const r=await f.app.inject({url:'/identity',headers:{authorization:'Bearer '+f.token()}});expect([401,403]).toContain(r.statusCode);}finally{await f.app.close();}});
 it('rechecks legacy account revocation before actor lookup',async()=>{const f=await fixture();try{const token=f.token();f.admin.updatedAt=new Date(1);expect((await f.app.inject({url:'/identity',headers:{authorization:'Bearer '+token}})).statusCode).toBe(401);expect(f.db.v11Actor.findUnique).not.toHaveBeenCalled();}finally{await f.app.close();}});
 it('rejects a user session at the controlled boundary',async()=>{const f=await fixture();try{expect((await f.app.inject({url:'/identity',headers:{authorization:'Bearer '+signSession(f.app,{sub:'user',role:'USER'})}})).statusCode).toBe(403);expect(f.db.v11Actor.findUnique).not.toHaveBeenCalled();}finally{await f.app.close();}});
 it.each(['malformed','duplicate-admin','duplicate-actor','missing-restaurant','foreign-restaurant','unknown-field','user-role'])('rejects invalid config %s without exposing raw config',kind=>{
 const value=kind==='malformed'?'private-invalid-config':JSON.stringify(kind==='duplicate-admin'?[base,{...base,actorId:'actor2'}]:kind==='duplicate-actor'?[base,{...base,adminId:'admin2'}]:[{...base,...(kind==='missing-restaurant'?{role:'RESTAURANT'}:kind==='foreign-restaurant'?{restaurantId:'rest'}:kind==='unknown-field'?{password:'do-not-echo'}:{role:'USER'})}]);
 expect(()=>parseControlledIdentityBindings(value)).toThrow('Invalid controlled V1.1 identity configuration');
 });
});
