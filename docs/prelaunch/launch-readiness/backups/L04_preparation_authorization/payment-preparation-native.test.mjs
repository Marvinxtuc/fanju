import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {root,verifyOwnedEnvironment} from '../../scripts/prelaunch-owned-env.mjs';
const repo=process.env.PRELAUNCH_SOURCE_ROOT??root;const require=createRequire(resolve(repo,'services/api/package.json'));
const {PrismaPg}=require('@prisma/adapter-pg');
const {PrismaClient}=await import(pathToFileURL(resolve(repo,'services/api/dist/generated/prisma/client.js')));
const {createPaymentPreparationStore}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/payment-preparation.js')));
const {createPaymentPreparationRunner}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/payment-preparation-runner.js')));
test('preparation persists and serializes on owned PostgreSQL',async t=>{
  const {runtime}=await verifyOwnedEnvironment('/tmp/fanju-prelaunch-20261001-b48140fda0c1');
  const db=new PrismaClient({adapter:new PrismaPg({connectionString:runtime.database_url})});const prefix='preparation_native_'+randomUUID().replaceAll('-','');
  try {
    const sample=await db.v11Registration.findFirst();assert.ok(sample,'owned synthetic registration fixture required');
    const consentSample=await db.v11BundleConsent.findUniqueOrThrow({where:{id:sample.consentId}});
    const create=async()=>{
      const suffix=randomUUID();const user=await db.user.create({data:{id:prefix+suffix,wechatOpenid:'mock_'+prefix+suffix}});
      const consent=await db.v11BundleConsent.create({data:{...consentSample,id:prefix+suffix+'_consent',userId:user.id}});
      const reg=await db.v11Registration.create({data:{...sample,id:prefix+suffix+'_reg',userId:user.id,consentId:consent.id}});
      return db.v11PaymentIntent.create({data:{registrationId:reg.id,merchantOrderNo:prefix+'_'+suffix,channel:'wechat',merchantScope:'a'.repeat(64),providerConfigId:'synthetic-v1',totalCents:100}});
    };
    const store=createPaymentPreparationStore(db);const row=await create();
    await t.test('twenty concurrent claims produce one durable submitting attempt',async()=>{
      const results=await Promise.allSettled(Array.from({length:20},()=>store.claim(row)));
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
      const saved=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:row.id}});assert.equal(saved.preparationState,'SUBMITTING');assert.equal(saved.preparationVersion,1);assert.equal(saved.state,'NEW');
    });
    await t.test('prepayment save does not confirm money and stale failures cannot undo it',async()=>{
      await store.savePrepared(row.id,1,'synthetic-prepay');await store.markUnknown(row.id,1);
      const saved=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:row.id}});assert.equal(saved.preparationState,'PREPARED');assert.equal(saved.prepayId,'synthetic-prepay');assert.equal(saved.state,'NEW');
      await assert.rejects(store.savePrepared(row.id,1,'other-prepay'));await assert.rejects(store.claim(saved));
    });
    await t.test('unknown outcome cannot be claimed for another submission',async()=>{
      const other=await create();const claimed=await store.claim(other);await store.markUnknown(other.id,claimed.preparationVersion);
      const saved=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:other.id}});assert.equal(saved.preparationState,'UNKNOWN');await assert.rejects(store.claim(saved));
    });
    await t.test('wrong binding and inactive intents reject without writes',async()=>{
      const other=await create();await assert.rejects(store.claim({...other,totalCents:101}));
      await db.v11PaymentIntent.update({where:{id:other.id},data:{active:false}});await assert.rejects(store.claim(other));
      assert.equal((await db.v11PaymentIntent.findUniqueOrThrow({where:{id:other.id}})).preparationVersion,0);
    });
    await t.test('database constraint rejects prepared state without a reference',async()=>{
      const other=await create();await assert.rejects(db.v11PaymentIntent.update({where:{id:other.id},data:{preparationState:'PREPARED'}}));
    });
    await t.test('runner persists submitting before network and prepay before returning',async()=>{
      const other=await create();let calls=0;
      const run=createPaymentPreparationRunner(store,{assertBinding(){},async preparePayment(input){calls++;
        const persisted=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:input.id}});assert.equal(persisted.preparationState,'SUBMITTING');
        return {kind:'PREPARED',prepayId:'synthetic-runner-prepay',paymentParams:{}};
      }});
      assert.equal((await run(other,'synthetic-openid')).kind,'PREPARED');
      const saved=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:other.id}});assert.equal(saved.prepayId,'synthetic-runner-prepay');assert.equal(saved.state,'NEW');
      await assert.rejects(run(saved,'synthetic-openid'));assert.equal(calls,1);
    });
    await t.test('runner timeout leaves unknown and cannot resend',async()=>{
      const other=await create();let calls=0;
      const run=createPaymentPreparationRunner(store,{assertBinding(){},async preparePayment(){calls++;throw Error('synthetic-channel-timeout');}});
      await assert.rejects(run(other,'synthetic-openid'));
      const saved=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:other.id}});assert.equal(saved.preparationState,'UNKNOWN');
      await assert.rejects(run(saved,'synthetic-openid'));assert.equal(calls,1);
    });
  } finally {await db.$disconnect();}
});
