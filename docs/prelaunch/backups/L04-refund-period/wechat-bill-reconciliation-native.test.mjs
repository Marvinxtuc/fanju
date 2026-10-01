import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash,createSign,X509Certificate} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {syntheticBill} from './fixtures/synthetic-bill.mjs';
const repo=process.env.PRELAUNCH_SOURCE_ROOT;if(!repo)throw Error('Explicit source required');
const require=createRequire(`${repo}/services/api/package.json`),{PrismaPg}=require('@prisma/adapter-pg');
const {PrismaClient}=await import(pathToFileURL(`${repo}/services/api/dist/generated/prisma/client.js`));
const {verifyOwnedDatabase}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/ownership.js`));
const {downloadWechatTradeBill}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-trade-bill.js`));
const {reconcileDownloadedWechatBill}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-reconciliation.js`));
test('verified bill snapshot detects both directions without granting financial state',async t=>{
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});await verifyOwnedDatabase(db,process.env);
 const dir=mkdtempSync(join(tmpdir(),'fanju-bill-native-'));const prefix='bill_native_'+randomUUID().replaceAll('-',''),date='2026-09-30',owner=prefix+'_owner',release='synthetic-bill-release';
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=fanju-synthetic-bill-native'],{stdio:'ignore'});
  const key=readFileSync(join(dir,'key.pem'),'utf8'),cert=readFileSync(join(dir,'cert.pem'),'utf8'),serial=new X509Certificate(cert).serialNumber;
  const env={WECHAT_PAY_ENABLED:'true',PAYMENT_PROVIDER:'wechat',REFUND_PROVIDER:'wechat',WECHAT_PAY_MCH_ID:prefix+'_mch',WECHAT_MINIAPP_APP_ID:'synthetic-app',WECHAT_PAY_PRIVATE_KEY_PATH:'synthetic-private',WECHAT_PAY_PLATFORM_CERT_PATH:'synthetic-platform',WECHAT_PAY_CERT_SERIAL_NO:'synthetic-serial',WECHAT_PAY_CONFIG_VERSION:prefix};
  async function acquire(raw){
   const metadata=JSON.stringify({hash_type:'SHA1',hash_value:createHash('sha1').update(raw).digest('hex'),download_url:'https://api.mch.weixin.qq.com/v3/billdownload/file?token=fixture-bill'}),timestamp=String(Math.floor(Date.now()/1000)),nonce='synthetic-nonce';const signer=createSign('RSA-SHA256');signer.update(`${timestamp}\n${nonce}\n${metadata}\n`);signer.end();
   let calls=0;return downloadWechatTradeBill(env,date,{readFile:path=>path==='synthetic-private'?key:cert,fetch:async()=>++calls===1?new Response(metadata,{headers:{'wechatpay-timestamp':timestamp,'wechatpay-nonce':nonce,'wechatpay-serial':serial,'wechatpay-signature':signer.sign(key,'base64')}}):new Response(raw)});
  }
  const sample=await db.v11Registration.findFirstOrThrow(),sampleConsent=await db.v11BundleConsent.findUniqueOrThrow({where:{id:sample.consentId}});
  const user=await db.user.create({data:{wechatOpenid:'mock_'+prefix}}),consent=await db.v11BundleConsent.create({data:{...sampleConsent,id:prefix+'_consent',userId:user.id}});
  const reg=await db.v11Registration.create({data:{...sample,id:prefix+'_reg',userId:user.id,consentId:consent.id,active:false}});
  const binding={channel:'wechat',merchantScope:createHash('sha256').update(env.WECHAT_PAY_MCH_ID+':synthetic-app').digest('hex'),providerConfigId:prefix};
  const intent=await db.v11PaymentIntent.create({data:{...binding,registrationId:reg.id,merchantOrderNo:prefix+'_order',totalCents:100,active:false,state:'CLOSED'}});
  const receipt=await db.channelReceipt.create({data:{channel:'wechat',merchantScope:binding.merchantScope,merchantOrderNo:intent.merchantOrderNo,channelTradeNo:prefix+'_trade',amountCents:100,evidenceHash:'synthetic-bill',verifiedAt:new Date(),paidAt:new Date(date+'T02:00:00Z')}});
  const refund=await db.v11RefundInstruction.create({data:{...binding,registrationId:reg.id,receiptId:receipt.id,businessKey:prefix+'_refund',merchantRefundNo:prefix+'_refund',originalTradeNo:receipt.channelTradeNo,totalCents:40,serviceFeeCents:40,depositCents:0,state:'UNKNOWN'}});
  const missing=await db.v11PaymentIntent.create({data:{...binding,registrationId:reg.id,merchantOrderNo:prefix+'_local-only',totalCents:100,active:false,state:'CLOSED'}});
  const missingReceipt=await db.channelReceipt.create({data:{channel:'wechat',merchantScope:binding.merchantScope,merchantOrderNo:missing.merchantOrderNo,channelTradeNo:prefix+'_local-trade',amountCents:100,evidenceHash:'synthetic-bill',verifiedAt:new Date(),paidAt:new Date(date+'T02:00:00Z')}});
  const records=[{kind:'PAYMENT',amountCents:100,orderNo:intent.merchantOrderNo,tradeNo:receipt.channelTradeNo},{kind:'REFUND',amountCents:40,refundCashCents:30,orderNo:intent.merchantOrderNo,tradeNo:receipt.channelTradeNo,merchantRefundNo:refund.merchantRefundNo,refundNo:prefix+'_channel-refund'}, {kind:'PAYMENT',amountCents:500,orderNo:prefix+'_orphan-order',tradeNo:prefix+'_orphan-trade'}, {kind:'REFUND',amountCents:30,orderNo:prefix+'_orphan-order',tradeNo:prefix+'_orphan-trade',merchantRefundNo:prefix+'_orphan-refund',refundNo:prefix+'_orphan-channel-refund'}, {kind:'PAYMENT',amountCents:20,appId:'other-app',orderNo:prefix+'_other-app-order',tradeNo:prefix+'_other-app-trade'}];
  const bill=await acquire(syntheticBill(date,records,env.WECHAT_PAY_MCH_ID)),runId=randomUUID();let result;
  await t.test('forged copied provenance and changed raw bytes fail before database writes',async()=>{
   await assert.rejects(()=>reconcileDownloadedWechatBill(db,env,{...bill},owner,release,runId));const first=bill.rawBill[0];bill.rawBill[0]=0;await assert.rejects(()=>reconcileDownloadedWechatBill(db,env,bill,owner,release,runId));bill.rawBill[0]=first;
   assert.equal(await db.auditLog.count({where:{targetId:runId}}),0);
  });
  await t.test('concurrent replay persists one snapshot, evidence, cases and query-only jobs',async()=>{
   const values=await Promise.all([reconcileDownloadedWechatBill(db,env,bill,owner,release,runId),reconcileDownloadedWechatBill(db,env,bill,owner,release,runId)]);assert.deepEqual(values[0],values[1]);result=values[0];
   assert.equal(result.totalBillRows,5);assert.equal(result.outsideApplicationRows,1);assert.equal(result.applicationPaymentRows,2);assert.equal(result.applicationRefundRows,2);assert.equal(result.differences,4);assert.equal(result.paymentQueriesQueued,2);assert.equal(result.refundQueriesQueued,1);assert.equal(result.coverageState,'INCOMPLETE');assert.equal(result.releaseAuthorized,false);
   assert.equal(await db.auditLog.count({where:{targetId:runId,action:'funding.v11-trade-bill-snapshot'}}),1);assert.equal(await db.financialCase.count({where:{owner}}),4);
   const jobs=await db.durableJob.findMany({where:{businessKey:{startsWith:'v11:bill-query:'+runId}}});assert.equal(jobs.length,3);assert.ok(jobs.every(x=>['V11_QUERY_PAYMENT','V11_QUERY_REFUND'].includes(x.kind)));
   const events=await db.receivedEvent.findMany({where:{source:'wechat-bill-observation-v11',merchantScope:binding.merchantScope,eventKey:{startsWith:'BILL:'+bill.sourceSha256}}});assert.equal(events.length,4);assert.ok(events.every(x=>x.state==='MANUAL'));assert.ok(!JSON.stringify(events).includes('synthetic-user-not-exported'));
   const unknown=await db.financialCase.findFirstOrThrow({where:{owner,category:'V11_BILL_PAYMENT_WITHOUT_INTENT'}});assert.ok(events.some(x=>x.id===unknown.sourceRef));
   assert.equal((await db.v11RefundInstruction.findUniqueOrThrow({where:{id:refund.id}})).state,'UNKNOWN');assert.equal((await db.v11PaymentIntent.findUniqueOrThrow({where:{id:intent.id}})).state,'CLOSED');assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:reg.id}})).active,false);assert.equal(await db.channelReceipt.count({where:{merchantOrderNo:{startsWith:prefix}}}),2);
  });
  await t.test('a run UUID cannot be reused for a changed owner or release',async()=>{for(const [changedOwner,changedRelease] of [[owner+'x',release],[owner,release+'x']])await assert.rejects(()=>reconcileDownloadedWechatBill(db,env,bill,changedOwner,changedRelease,runId),/replay identity conflict/);});
  await t.test('signed but malformed summary has no partial intake or audit',async()=>{
   const bad=await acquire(Buffer.from(syntheticBill(date,records,env.WECHAT_PAY_MCH_ID).toString().replace('`5,`6.20','`5,`99.00'))),id=randomUUID();await assert.rejects(()=>reconcileDownloadedWechatBill(db,env,bad,owner,release,id),/CSV/);assert.equal(await db.auditLog.count({where:{targetId:id}}),0);assert.equal(await db.receivedEvent.count({where:{eventKey:{startsWith:'BILL:'+bad.sourceSha256}}}),0);
  });
  await t.test('a newer empty bill detects local receipts instead of declaring zero differences',async()=>{
   const empty=await acquire(syntheticBill(date,[],env.WECHAT_PAY_MCH_ID)),id=randomUUID(),report=await reconcileDownloadedWechatBill(db,env,empty,owner,release,id);assert.equal(report.totalBillRows,0);assert.ok(report.differences>=2);assert.equal(report.coverageState,'INCOMPLETE');const batch=await db.reconciliationBatch.findUniqueOrThrow({where:{merchantScope_period_sourceHash:{merchantScope:binding.merchantScope,period:date,sourceHash:'v11:'+empty.sourceSha256}}});assert.equal(batch.coverageState,'INCOMPLETE');
  });
  await t.test('a persisted evidence conflict rolls back all earlier event and job writes',async()=>{
   const conflictBill=await acquire(syntheticBill(date,[records[0],{kind:'PAYMENT',amountCents:25,orderNo:prefix+'_conflict-order',tradeNo:prefix+'_conflict-trade'}],env.WECHAT_PAY_MCH_ID)),id=randomUUID();
   await db.receivedEvent.create({data:{source:'wechat-bill-observation-v11',merchantScope:binding.merchantScope,eventKey:'BILL:'+conflictBill.sourceSha256+':1',payloadHash:'synthetic-conflicting-hash',normalizedPayload:{scope:'synthetic-corruption-test'},verificationMaterialId:prefix,verifiedAt:new Date(),state:'MANUAL'}});
   await assert.rejects(()=>reconcileDownloadedWechatBill(db,env,conflictBill,owner,release,id),/observation identity conflict/);
   assert.equal(await db.auditLog.count({where:{targetId:id}}),0);assert.equal(await db.durableJob.count({where:{businessKey:{startsWith:'v11:bill-query:'+id}}}),0);
   assert.equal(await db.receivedEvent.count({where:{source:'wechat-bill-observation-v11',merchantScope:binding.merchantScope,eventKey:'BILL:'+conflictBill.sourceSha256+':0'}}),0);
  });
  await t.test('conflicting gross amounts remain independent evidence without overwriting money',async()=>{
   const conflicting=await acquire(syntheticBill(date,[{...records[0],amountCents:125},{...records[1],amountCents:45}],env.WECHAT_PAY_MCH_ID)),id=randomUUID();
   const report=await reconcileDownloadedWechatBill(db,env,conflicting,owner,release,id);assert.ok(report.differences>=3);
   const audit=await db.auditLog.findFirstOrThrow({where:{targetId:id,action:'funding.v11-trade-bill-snapshot'}}),cases=await db.financialCase.findMany({where:{id:{in:audit.metadata.caseIds}}});
   for(const category of ['V11_BILL_PAYMENT_AMOUNT_CONFLICT','V11_BILL_PAYMENT_RECEIPT_CONFLICT','V11_BILL_REFUND_FACT_CONFLICT'])assert.ok(cases.some(x=>x.category===category));
   assert.equal((await db.channelReceipt.findUniqueOrThrow({where:{id:receipt.id}})).amountCents,100);assert.equal((await db.v11PaymentIntent.findUniqueOrThrow({where:{id:intent.id}})).totalCents,100);assert.equal((await db.v11RefundInstruction.findUniqueOrThrow({where:{id:refund.id}})).totalCents,40);
   await assert.rejects(()=>reconcileDownloadedWechatBill(db,{...env,WECHAT_PAY_CONFIG_VERSION:prefix+'_other'},conflicting,owner,release,randomUUID()),/identity required/);
  });
  await t.test('new snapshot can observe resolution without automatically closing old cases',async()=>{
   await db.v11RefundInstruction.update({where:{id:refund.id},data:{state:'CONFIRMED',channelRefundNo:prefix+'_channel-refund'}});
   const report=await reconcileDownloadedWechatBill(db,env,bill,owner,release,randomUUID());assert.equal(report.differences,3);assert.equal((await db.channelReceipt.findUniqueOrThrow({where:{id:missingReceipt.id}})).paidAt.toISOString(),date+'T02:00:00.000Z');assert.equal(report.confirmedRefundsWithoutTrustedPeriod,1);assert.equal(report.refundPeriodCoverage,'UNRESOLVED');assert.equal(report.coverageState,'INCOMPLETE');assert.ok((await db.financialCase.findMany({where:{owner}})).every(x=>x.state==='OPEN'));
  });
 }finally{await db.$disconnect();rmSync(dir,{recursive:true,force:true});}
});
