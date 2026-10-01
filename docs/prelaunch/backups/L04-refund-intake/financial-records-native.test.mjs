import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const repo=process.env.PRELAUNCH_SOURCE_ROOT;if(!repo)throw Error('Explicit owned source root required');
const require=createRequire(`${repo}/services/api/package.json`);const {PrismaPg}=require('@prisma/adapter-pg');const Fastify=require('fastify');
const {PrismaClient}=await import(pathToFileURL(`${repo}/services/api/dist/generated/prisma/client.js`));
const {verifyOwnedDatabase}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/ownership.js`));
const {registerAuth,signSession}=await import(pathToFileURL(`${repo}/services/api/dist/auth.js`));
const {registerProductionIdentityRoutes}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/production-identity-routes.js`));
const {errorResponse}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/contracts.js`));
test('formal user can read only own recorded money without granting policy eligibility',async t=>{
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});await verifyOwnedDatabase(db,process.env);
 const app=Fastify();const prefix='funds_native_'+randomUUID().replaceAll('-','');
 try{
  const sample=await db.v11Registration.findFirstOrThrow();const sampleConsent=await db.v11BundleConsent.findUniqueOrThrow({where:{id:sample.consentId}});
  const users=[];for(const suffix of ['a','b']){const user=await db.user.create({data:{wechatOpenid:'mock_'+prefix+suffix}});await db.v11Actor.create({data:{userId:user.id,personId:prefix+suffix,role:'USER',passwordHash:'synthetic-unused'}});users.push(user);}
  const consent=await db.v11BundleConsent.create({data:{...sampleConsent,id:prefix+'_consent',userId:users[0].id}});
  const reg=await db.v11Registration.create({data:{...sample,id:prefix+'_reg',userId:users[0].id,consentId:consent.id,active:false,serviceFeeCents:100,depositCents:0}});
  const binding={channel:'wechat',merchantScope:'d'.repeat(64),providerConfigId:'synthetic-money-v1'};
  const intent=await db.v11PaymentIntent.create({data:{...binding,registrationId:reg.id,merchantOrderNo:prefix+'_order',totalCents:100,active:false,state:'CLOSED'}});
  const receipt=await db.channelReceipt.create({data:{channel:'wechat',merchantScope:binding.merchantScope,channelTradeNo:prefix+'_trade',merchantOrderNo:intent.merchantOrderNo,amountCents:100,evidenceHash:'synthetic',verifiedAt:new Date(),paidAt:new Date()}});
  const refund=await db.v11RefundInstruction.create({data:{...binding,registrationId:reg.id,receiptId:receipt.id,businessKey:prefix+'_refund',merchantRefundNo:prefix+'_refund',originalTradeNo:receipt.channelTradeNo,totalCents:40,serviceFeeCents:40,depositCents:0,state:'CONFIRMED',channelRefundNo:prefix+'_channel-refund'}});
  await registerAuth(app,db,{APP_ENV:'test',SESSION_SECRET:'synthetic-only-session-key-32-characters'});
  registerProductionIdentityRoutes(app,db,{FEATURE_V11_IDENTITY:'true',FEATURE_V11_FINANCIAL_RECORDS:'true'},{auth:{mode:'wechat'},phone:{mode:'wechat'}},false);
  app.setErrorHandler((error,_req,reply)=>{if('issues'in error)return reply.code(400).send({error:'INVALID_INPUT'});const result=errorResponse(error);return reply.code(result.statusCode).send(result.body);});
  const url='/api/v11/registrations/'+reg.id+'/funds';const headers={authorization:'Bearer '+signSession(app,{sub:users[0].id,role:'USER'})};
  await t.test('unallocated late receipt remains visible despite inactive registration and draft policy',async()=>{
   const result=await app.inject({url,headers});assert.equal(result.statusCode,200);const data=result.json();
   assert.equal(data.paidCents,100);assert.equal(data.confirmedRefundCents,40);assert.equal(data.unallocatedReceiptCount,1);assert.equal(data.eligibilityGranted,false);assert.equal(data.policyActivation,'NOT_ASSESSED');
   for(const value of [prefix+'_trade',prefix+'_order',prefix+'_channel-refund','merchantScope','providerConfigId','userId','openid','address','prepayId'])assert.ok(!result.body.includes(value));
   assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:reg.id}})).active,false);
  });
  await t.test('foreign user and unsigned request cannot access the record',async()=>{
   assert.equal((await app.inject({url,headers:{authorization:'Bearer '+signSession(app,{sub:users[1].id,role:'USER'})}})).statusCode,404);
   assert.equal((await app.inject({url})).statusCode,401);
   assert.equal((await app.inject({url,headers:{authorization:'Bearer '+signSession(app,{sub:'legacy-ops',role:'OPS'})}})).statusCode,403);
   assert.equal((await app.inject({url:url+'?userId='+users[1].id,headers})).statusCode,400);
  });
  await t.test('allocation does not change monetary totals and unrelated mock facts are excluded',async()=>{
   await db.v11ReceiptBinding.create({data:{receiptId:receipt.id,intentId:intent.id,registrationId:reg.id,classification:'PRIMARY'}});
   const mock=await db.v11PaymentIntent.create({data:{registrationId:reg.id,merchantOrderNo:prefix+'_mock-order',totalCents:100}});
   await db.channelReceipt.create({data:{channel:'mock',merchantScope:'mock-local',channelTradeNo:prefix+'_mock-trade',merchantOrderNo:mock.merchantOrderNo,amountCents:100,evidenceHash:'synthetic',verifiedAt:new Date(),paidAt:new Date()}});
   const result=await app.inject({url,headers});assert.equal(result.statusCode,200);assert.equal(result.json().paidCents,100);assert.equal(result.json().unallocatedReceiptCount,0);
  });
  await t.test('receipt binding assigned to another registration cannot leak into either user view',async()=>{
   const secondConsent=await db.v11BundleConsent.create({data:{...sampleConsent,id:prefix+'_second-consent',userId:users[1].id}});
   const other=await db.v11Registration.create({data:{...sample,id:prefix+'_other-reg',userId:users[1].id,consentId:secondConsent.id,active:false}});
   await db.v11ReceiptBinding.update({where:{receiptId:receipt.id},data:{registrationId:other.id}});
   assert.equal((await app.inject({url,headers})).statusCode,503);
   const result=await app.inject({url:'/api/v11/registrations/'+other.id+'/funds',headers:{authorization:'Bearer '+signSession(app,{sub:users[1].id,role:'USER'})}});
   assert.equal(result.statusCode,200);assert.equal(result.json().paidCents,0);assert.equal(result.json().receipts.length,0);
   await db.v11ReceiptBinding.update({where:{receiptId:receipt.id},data:{registrationId:reg.id}});
  });
  await t.test('conflicting original refund identity fails closed without financial writes',async()=>{
   await db.v11RefundInstruction.update({where:{id:refund.id},data:{originalTradeNo:prefix+'_wrong-trade'}});
   const result=await app.inject({url,headers});assert.equal(result.statusCode,503);assert.equal(result.json().error.code,'FUNDS_DATA_CONFLICT');assert.equal(await db.channelReceipt.count({where:{id:receipt.id}}),1);
   await db.v11RefundInstruction.update({where:{id:refund.id},data:{originalTradeNo:receipt.channelTradeNo}});
   const actor=await db.v11Actor.findFirstOrThrow({where:{userId:users[0].id}});await db.v11Actor.update({where:{id:actor.id},data:{enabled:false}});
   assert.equal((await app.inject({url,headers})).statusCode,401);
  });
 }finally{await app.close();await db.$disconnect();}
});
