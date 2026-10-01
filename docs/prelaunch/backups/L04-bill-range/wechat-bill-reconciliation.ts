import {trustedRefundCompletionTime} from './refund-period-evidence.js';
import {createHash} from 'node:crypto';
import type {PrismaClient} from '../generated/prisma/client.js';
import {bindingFor} from '../funding/intents.js';
import type {ProviderEnv} from '../providers.js';
import {enqueue} from '../jobs/queue.js';
import {assertDownloadedTradeBill,type downloadWechatTradeBill} from './wechat-trade-bill.js';
import {parseWechatAllBill} from './wechat-bill-csv.js';

type Downloaded=Awaited<ReturnType<typeof downloadWechatTradeBill>>;
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));return value;}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))??'null').digest('hex');
// Internal trusted acquisition only. Never accepts uploaded JSON/CSV as verified.
// CSV discrepancies schedule trusted queries; they do not create money or eligibility.
export async function reconcileDownloadedWechatBill(db:PrismaClient,env:ProviderEnv,bill:Downloaded,owner:string,releaseVersion:string,runId:string){
 assertDownloadedTradeBill(bill);
 const binding=bindingFor(env,'wechat');
 if(JSON.stringify(binding)!==JSON.stringify(bill.binding)||!owner.trim()||owner.length>160||!releaseVersion.trim()||releaseVersion.length>160
  ||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId))throw Error('Explicit verified bill reconciliation identity required');
 const parsed=parseWechatAllBill(bill.rawBill,{billDate:bill.billDate,merchantId:env.WECHAT_PAY_MCH_ID!,appId:env.WECHAT_MINIAPP_APP_ID!});
 const at=new Date(bill.billDate+'T00:00:00+08:00'),until=new Date(at.getTime()+86400000);
 const identity={comparisonVersion:'v11-bill-snapshot-2',binding:{...binding},owner,releaseVersion,sourceSha256:bill.sourceSha256,billDate:bill.billDate};
 for(let attempt=0;attempt<3;attempt++)try{return await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe("SET LOCAL statement_timeout='15000ms'");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`v11-bill-run:${runId}`},0))`;
  const prior=await tx.auditLog.findFirst({where:{action:'funding.v11-trade-bill-snapshot',targetType:'V11TradeBillRun',targetId:runId}});
  if(prior){const metadata=prior.metadata as unknown as {identity:typeof identity;result:Record<string,unknown>};if(hash(metadata?.identity)!==hash(identity)||metadata.result?.coverageState!=='INCOMPLETE'||metadata.result?.runId!==runId||metadata.result?.releaseAuthorized!==false)throw Error('Bill reconciliation replay identity conflict');return metadata.result;}
  const intents=await tx.v11PaymentIntent.findMany({where:{channel:'wechat',merchantScope:binding.merchantScope}});
  const receipts=await tx.channelReceipt.findMany({where:{channel:'wechat',merchantScope:binding.merchantScope},include:{v11ReceiptBinding_receiptId:true}});
  const refunds=await tx.v11RefundInstruction.findMany({where:{channel:'wechat',merchantScope:binding.merchantScope},include:{receipt:true}});
  const timeEvents=await tx.receivedEvent.findMany({where:{source:'wechat-refund-time-query-v11',merchantScope:binding.merchantScope}});
  const refundTimes=new Map(refunds.filter(x=>x.state==='CONFIRMED').map(x=>[x.id,trustedRefundCompletionTime(x,x.receipt,timeEvents)]));
  const intentByOrder=new Map(intents.map(row=>[row.merchantOrderNo,row]));
  const refundByMerchantNo=new Map(refunds.map(row=>[row.merchantRefundNo,row]));
  const receiptByTrade=new Map(receipts.map(row=>[row.channelTradeNo,row]));
  const receiptsByOrder=new Map<string,typeof receipts>();for(const row of receipts)receiptsByOrder.set(row.merchantOrderNo,[...(receiptsByOrder.get(row.merchantOrderNo)??[]),row]);
  const caseIds=new Set<string>();
  const stats={runId,billDate:bill.billDate,totalBillRows:parsed.totalRows,outsideApplicationRows:parsed.outsideApplicationRows,
   applicationPaymentRows:0,applicationRefundRows:0,legacyRows:0,differences:0,paymentQueriesQueued:0,refundQueriesQueued:0,
   recordedPaymentRowsInPeriod:0,confirmedRefundsWithoutTrustedPeriod:[...refundTimes.values()].filter(x=>x.status!=='TRUSTED').length,
   confirmedRefundsInPeriod:0,refundTimeConflicts:[...refundTimes.values()].filter(x=>x.status==='CONFLICT').length,
   scope:'BILL_AND_RECORDED_FUNDS_SNAPSHOT',coverageState:'INCOMPLETE',refundPeriodCoverage:[...refundTimes.values()].some(x=>x.status!=='TRUSTED')?'UNRESOLVED':'OBSERVED',releaseAuthorized:false};
  const paymentJobs=new Set<string>(),refundJobs=new Set<string>();
  const difference=async(category:string,reference:string)=>{stats.differences++;const row=await tx.financialCase.upsert({where:{caseKey:category+':'+hash([runId,reference])},update:{},create:{caseKey:category+':'+hash([runId,reference]),category,sourceRef:reference,owner,deadline:new Date(Date.now()+24*60*60*1000)}});caseIds.add(row.id);};
  const queuePayment=async(intent:typeof intents[number])=>{if(intent.providerConfigId!==binding.providerConfigId){await difference('V11_BILL_PROVIDER_BINDING_CONFLICT',intent.id);return;}if(paymentJobs.has(intent.id))return;paymentJobs.add(intent.id);await enqueue(tx,'V11_QUERY_PAYMENT',`v11:bill-query:${runId}:payment:${intent.id}`,intent.id);};
  const queueRefund=async(refund:typeof refunds[number])=>{if(refund.providerConfigId!==binding.providerConfigId){await difference('V11_BILL_PROVIDER_BINDING_CONFLICT',refund.id);return;}if(refundJobs.has(refund.id))return;refundJobs.add(refund.id);await enqueue(tx,'V11_QUERY_REFUND',`v11:bill-query:${runId}:refund:${refund.id}`,refund.id);};
  const scoped=parsed.observations.filter(x=>x.inApplicationScope);
  for(const [index,observation] of parsed.observations.entries()){
   if(!observation.inApplicationScope)continue;
   const eventKey=`BILL:${bill.sourceSha256}:${index}`;
   const payload={...observation,scope:'BILL_OBSERVATION_ONLY',billDate:bill.billDate};
   const payloadHash=hash(payload);
   const event=await tx.receivedEvent.upsert({where:{source_merchantScope_eventKey:{source:'wechat-bill-observation-v11',merchantScope:binding.merchantScope,eventKey}},update:{},create:{source:'wechat-bill-observation-v11',merchantScope:binding.merchantScope,eventKey,payloadHash,normalizedPayload:payload,verificationMaterialId:binding.providerConfigId,verifiedAt:new Date(bill.verifiedAt),state:'MANUAL'}});
   if(event.payloadHash!==payloadHash||event.state!=='MANUAL')throw Error('Bill observation identity conflict');
   if(observation.kind==='PAYMENT'){
    stats.applicationPaymentRows++;
    const intent=intentByOrder.get(observation.merchantOrderNo);
    if(!intent){const legacy=await tx.payment.findFirst({where:{channel:'wechat',merchantScope:binding.merchantScope,merchantOrderNo:observation.merchantOrderNo},select:{id:true}});if(legacy)stats.legacyRows++;else await difference('V11_BILL_PAYMENT_WITHOUT_INTENT',event.id);continue;}
    await queuePayment(intent);
    if(intent.totalCents!==observation.amountCents)await difference('V11_BILL_PAYMENT_AMOUNT_CONFLICT',intent.id);
    const byTrade=receiptByTrade.get(observation.channelTradeNo);const matched=[...new Map([...(receiptsByOrder.get(observation.merchantOrderNo)??[]),...(byTrade?[byTrade]:[])].map(x=>[x.id,x])).values()];
    if(!matched.length)await difference('V11_BILL_PAYMENT_RECEIPT_MISSING',intent.id);
    else if(matched.length!==1||matched.some(x=>x.channelTradeNo!==observation.channelTradeNo||x.merchantOrderNo!==observation.merchantOrderNo
     ||x.amountCents!==observation.amountCents||x.currency!=='CNY'||x.paidAt?.getTime()!==Date.parse(observation.observedAt)||x.paymentId||x.orderId
     ||(x.v11ReceiptBinding_receiptId&&(x.v11ReceiptBinding_receiptId.intentId!==intent.id||x.v11ReceiptBinding_receiptId.registrationId!==intent.registrationId))))await difference('V11_BILL_PAYMENT_RECEIPT_CONFLICT',intent.id);
   }else{
    stats.applicationRefundRows++;
    const refund=refundByMerchantNo.get(observation.merchantRefundNo!);
    if(!refund){const legacy=await tx.refund.findFirst({where:{channel:'wechat',merchantScope:binding.merchantScope,merchantRefundNo:observation.merchantRefundNo!},select:{id:true}});if(legacy)stats.legacyRows++;else await difference('V11_BILL_REFUND_WITHOUT_INSTRUCTION',event.id);continue;}
    await queueRefund(refund);
    if(refund.totalCents!==observation.amountCents||refund.originalTradeNo!==observation.channelTradeNo||refund.receipt.channelTradeNo!==observation.channelTradeNo
     ||refund.receipt.merchantOrderNo!==observation.merchantOrderNo||refund.receipt.merchantScope!==binding.merchantScope||refund.receipt.channel!=='wechat'
     ||(refund.channelRefundNo&&refund.channelRefundNo!==observation.channelRefundNo)||refund.totalCents!==refund.serviceFeeCents+refund.depositCents)
     await difference('V11_BILL_REFUND_FACT_CONFLICT',refund.id);
    else if(refund.state!=='CONFIRMED'||!refund.channelRefundNo)await difference('V11_BILL_REFUND_LOCAL_UNCONFIRMED',refund.id);
    const time=refundTimes.get(refund.id);if(time?.status==='TRUSTED'&&time.refundedAt!==observation.observedAt)await difference('V11_BILL_REFUND_TIME_CONFLICT',refund.id);
   }
  }
  const billPaymentKeys=new Set(scoped.filter(x=>x.kind==='PAYMENT').map(x=>JSON.stringify([x.channelTradeNo,x.merchantOrderNo])));
  for(const receipt of receipts.filter(x=>x.paidAt&&x.paidAt>=at&&x.paidAt<until)){
   const intent=intentByOrder.get(receipt.merchantOrderNo);
   if(!intent){if(receipt.v11ReceiptBinding_receiptId)await difference('V11_BILL_LOCAL_RECEIPT_WITHOUT_INTENT',receipt.id);continue;}
   stats.recordedPaymentRowsInPeriod++;
   if(!billPaymentKeys.has(JSON.stringify([receipt.channelTradeNo,receipt.merchantOrderNo]))){
    await difference('V11_BILL_LOCAL_PAYMENT_ABSENT',receipt.id);await queuePayment(intent);
   }
  }
  const billRefunds=new Map(scoped.filter(x=>x.kind==='REFUND').map(x=>[x.merchantRefundNo,x]));
  for(const refund of refunds.filter(x=>x.state==='CONFIRMED')){
   const time=refundTimes.get(refund.id)!;
   if(time.status!=='TRUSTED'){
    await difference(time.status==='MISSING'?'V11_BILL_REFUND_PERIOD_UNKNOWN':'V11_BILL_REFUND_PERIOD_CONFLICT',refund.id);await queueRefund(refund);continue;
   }
   const completedAt=new Date(time.refundedAt);
   if(completedAt<at||completedAt>=until)continue;
   stats.confirmedRefundsInPeriod++;
   const row=billRefunds.get(refund.merchantRefundNo);
   if(!row||row.channelRefundNo!==refund.channelRefundNo||row.channelTradeNo!==refund.originalTradeNo||row.amountCents!==refund.totalCents||row.observedAt!==time.refundedAt){
    await difference('V11_BILL_LOCAL_REFUND_ABSENT_OR_CONFLICT',refund.id);await queueRefund(refund);
   }
  }
  stats.paymentQueriesQueued=paymentJobs.size;stats.refundQueriesQueued=refundJobs.size;
  const batch=await tx.reconciliationBatch.upsert({where:{merchantScope_period_sourceHash:{merchantScope:binding.merchantScope,period:bill.billDate,sourceHash:'v11:'+bill.sourceSha256}},create:{merchantScope:binding.merchantScope,period:bill.billDate,sourceHash:'v11:'+bill.sourceSha256,coverageState:'INCOMPLETE'},update:{coverageState:'INCOMPLETE'}});
  await tx.$executeRaw`UPDATE "ReconciliationBatch" SET "decisionOrdinal"=nextval('"ReconciliationBatch_decisionOrdinal_seq"') WHERE id=${batch.id}`;
  await tx.auditLog.create({data:{action:'funding.v11-trade-bill-snapshot',targetType:'V11TradeBillRun',targetId:runId,
   metadata:{identity,result:stats,caseIds:[...caseIds],batchId:batch.id,verifiedMetadataSha256:bill.metadataSha256,scope:'VERIFIED_BILL_COMPARISON_NO_FINANCIAL_WRITE'}}});
  return stats;
 },{isolationLevel:'Serializable',timeout:30000});}
 catch(error){if(attempt===2||!(error&&typeof error==='object'&&'code'in error&&['P2034','P2002'].includes(String(error.code))))throw error;}
 throw Error('Bill snapshot unavailable');
}
