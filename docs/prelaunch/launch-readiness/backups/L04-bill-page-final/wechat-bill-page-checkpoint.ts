import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {PrismaClient,Prisma,V11BillComparisonPage} from '../generated/prisma/client.js';
import type {ProviderEnv} from '../providers.js';
import type {downloadWechatTradeBill} from './wechat-trade-bill.js';
import {loadBillComparisonSnapshot,executeBillComparisonCore,type BillComparisonRange} from './wechat-bill-comparison-core.js';
type Bill=Awaited<ReturnType<typeof downloadWechatTradeBill>>;
type Loaded=Awaited<ReturnType<typeof loadBillComparisonSnapshot>>;
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));return value;}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))??'null').digest('hex');
const count=z.number().int().nonnegative().max(1000000);
function retryableTransaction(error:unknown){
 if(!error||typeof error!=='object'||!('code'in error))return false;
 if(['P2034','P2002'].includes(String(error.code)))return true;
 if(error.code!=='P2010'||!('meta'in error)||!error.meta||typeof error.meta!=='object')return false;
 if('code'in error.meta&&['40001','40P01'].includes(String(error.meta.code)))return true;
 if(!('driverAdapterError'in error.meta))return false;
 const adapter=error.meta.driverAdapterError;
 if(!adapter||typeof adapter!=='object'||!('cause'in adapter))return false;
 const cause=adapter.cause;
 return !!cause&&typeof cause==='object'&&'originalCode'in cause&&['40001','40P01'].includes(String(cause.originalCode));
}
const resultSchema=z.object({runId:z.string(),billDate:z.string(),totalBillRows:count,outsideApplicationRows:count,applicationPaymentRows:count,applicationRefundRows:count,legacyRows:count,differences:count,paymentQueriesQueued:count,refundQueriesQueued:count,recordedPaymentRowsInPeriod:count,confirmedRefundsWithoutTrustedPeriod:count,confirmedRefundsInPeriod:count,refundTimeConflicts:count,scope:z.literal('BILL_AND_RECORDED_FUNDS_SNAPSHOT'),coverageState:z.literal('INCOMPLETE'),refundPeriodCoverage:z.enum(['UNRESOLVED','OBSERVED']),releaseAuthorized:z.literal(false)}).strict();
function validateRange(bill:Bill,loaded:Loaded,range:BillComparisonRange){
 const at=Date.parse(bill.billDate+'T00:00:00+08:00'),until=at+86400000;
 const length=range.phase==='FORWARD'?loaded.plan.observations.length:range.phase==='REVERSE_RECEIPTS'?loaded.facts.receipts.filter(x=>x.paidAt&&x.paidAt.getTime()>=at&&x.paidAt.getTime()<until).length:range.phase==='REVERSE_REFUNDS'?loaded.facts.refunds.filter(x=>x.state==='CONFIRMED').length:-1;
 if(!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.end)||range.start<0||range.start%500!==0||range.start>=length||range.end!==Math.min(range.start+500,length))throw Error('Invalid fixed comparison page');
}
function content(row:{snapshotHash:string;phase:string;start:number;end:number;result:unknown;caseIds:string[];paymentQueryRefs:string[];refundQueryRefs:string[]}){return {version:'v11-bill-page-1',snapshotHash:row.snapshotHash,phase:row.phase,start:row.start,end:row.end,result:row.result,caseIds:row.caseIds,paymentQueryRefs:row.paymentQueryRefs,refundQueryRefs:row.refundQueryRefs};}
async function checkPage(tx:Prisma.TransactionClient,bill:Bill,loaded:Loaded,runId:string,range:BillComparisonRange,row:V11BillComparisonPage){
 const result=resultSchema.parse(row.result);
 if(row.snapshotId!==runId||row.phase!==range.phase||row.start!==range.start||row.end!==range.end||row.snapshotHash!==loaded.snapshotHash||row.contentHash!==hash(content(row))||result.runId!==runId||result.billDate!==bill.billDate||result.totalBillRows!==loaded.plan.totalRows||result.outsideApplicationRows!==loaded.plan.outsideApplicationRows||new Set(row.caseIds).size!==row.caseIds.length||row.caseIds.length>result.differences)throw Error('Comparison checkpoint integrity conflict');
 if(row.caseIds.length>2000||row.paymentQueryRefs.length>500||row.refundQueryRefs.length>500||[...row.caseIds,...row.paymentQueryRefs,...row.refundQueryRefs].some(x=>!x||x.length>160)||result.differences>(range.end-range.start)*4||result.recordedPaymentRowsInPeriod>range.end-range.start||result.confirmedRefundsInPeriod>range.end-range.start||result.legacyRows>result.applicationPaymentRows+result.applicationRefundRows)throw Error('Comparison checkpoint bounds conflict');
 const times=[...loaded.facts.refundTimes.values()];
 if(result.confirmedRefundsWithoutTrustedPeriod!==times.filter(x=>x.status!=='TRUSTED').length||result.refundTimeConflicts!==times.filter(x=>x.status==='CONFLICT').length||result.refundPeriodCoverage!==(times.some(x=>x.status!=='TRUSTED')?'UNRESOLVED':'OBSERVED'))throw Error('Comparison checkpoint coverage conflict');
 const observations=range.phase==='FORWARD'?loaded.plan.observations.slice(range.start,range.end).map((observation,index)=>({observation,index:range.start+index})).filter(x=>x.observation.inApplicationScope):[];
 if(result.applicationPaymentRows!==observations.filter(x=>x.observation.kind==='PAYMENT').length||result.applicationRefundRows!==observations.filter(x=>x.observation.kind==='REFUND').length||(range.phase!=='REVERSE_RECEIPTS'&&result.recordedPaymentRowsInPeriod!==0)||(range.phase!=='REVERSE_REFUNDS'&&result.confirmedRefundsInPeriod!==0))throw Error('Comparison checkpoint phase conflict');
 if(row.caseIds.length){
  const cases=await tx.financialCase.findMany({where:{id:{in:row.caseIds}},select:{id:true,category:true,sourceRef:true,caseKey:true}});
  if(cases.length!==row.caseIds.length||cases.some(x=>!x.category.startsWith('V11_BILL_')||x.caseKey!==x.category+':'+hash([runId,x.sourceRef])))throw Error('Comparison checkpoint case evidence missing');
 }
 if(new Set(row.paymentQueryRefs).size!==row.paymentQueryRefs.length||new Set(row.refundQueryRefs).size!==row.refundQueryRefs.length||result.paymentQueriesQueued!==row.paymentQueryRefs.length||result.refundQueriesQueued!==row.refundQueryRefs.length)throw Error('Comparison checkpoint query count conflict');
 const expectedQueries=[...row.paymentQueryRefs.map(refId=>({refId,kind:'V11_QUERY_PAYMENT',businessKey:`v11:bill-query:${runId}:payment:${refId}`})),...row.refundQueryRefs.map(refId=>({refId,kind:'V11_QUERY_REFUND',businessKey:`v11:bill-query:${runId}:refund:${refId}`}))];
 if(expectedQueries.length){const jobs=await tx.durableJob.findMany({where:{businessKey:{in:expectedQueries.map(x=>x.businessKey)}},select:{refId:true,kind:true,businessKey:true}});if(jobs.length!==expectedQueries.length||expectedQueries.some(x=>!jobs.some(j=>j.businessKey===x.businessKey&&j.refId===x.refId&&j.kind===x.kind)))throw Error('Comparison checkpoint query evidence missing');}
 if(observations.length){
  const expected=new Map(observations.map(({observation,index})=>{const eventKey=`BILL:${bill.sourceSha256}:${index}`;return [eventKey,hash({...observation,scope:'BILL_OBSERVATION_ONLY',billDate:bill.billDate})];}));
  const events=await tx.receivedEvent.findMany({where:{source:'wechat-bill-observation-v11',merchantScope:loaded.binding.merchantScope,eventKey:{in:[...expected.keys()]}},select:{eventKey:true,payloadHash:true,normalizedPayload:true,state:true,verificationMaterialId:true}});
  if(events.length!==expected.size||events.some(x=>x.state!=='MANUAL'||x.verificationMaterialId!==loaded.binding.providerConfigId||x.payloadHash!==expected.get(x.eventKey)||hash(x.normalizedPayload)!==x.payloadHash))throw Error('Comparison checkpoint observation evidence missing');
 }
 return result;
}
// Internal privileged DB orchestration only. No new HTTP endpoint or funds I/O.
// Fixed 500-row pages; writes and checkpoint share one Serializable transaction.
export async function commitBillComparisonPage(db:PrismaClient,env:ProviderEnv,bill:Bill,owner:string,releaseVersion:string,runId:string,range:BillComparisonRange){
 for(let attempt=0;attempt<3;attempt++)try{
  return await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe("SET LOCAL statement_timeout='15000ms'");
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`v11-bill-run:${runId}`},0))`;
   const loaded=await loadBillComparisonSnapshot(tx,env,bill,owner,releaseVersion,runId);validateRange(bill,loaded,range);
   const key={snapshotId:runId,phase:range.phase,start:range.start};
   const existing=await tx.v11BillComparisonPage.findUnique({where:{snapshotId_phase_start:key}});
   if(existing){await checkPage(tx,bill,loaded,runId,range,existing);return {status:'RESUMED',phase:range.phase,start:range.start,end:range.end,releaseAuthorized:false};}
   const output=await executeBillComparisonCore(tx,bill,owner,runId,loaded.binding,loaded.plan,loaded.facts,range);
   const body={snapshotHash:loaded.snapshotHash,phase:range.phase,start:range.start,end:range.end,result:output.stats,caseIds:output.caseIds,paymentQueryRefs:output.queryRefs.payment,refundQueryRefs:output.queryRefs.refund};
   const row=await tx.v11BillComparisonPage.create({data:{snapshotId:runId,...body,contentHash:hash(content(body))}});
   await checkPage(tx,bill,loaded,runId,range,row);
   return {status:'COMMITTED',phase:range.phase,start:range.start,end:range.end,releaseAuthorized:false};
  },{isolationLevel:'Serializable',timeout:30000});
 }catch(error){if(attempt===2||!retryableTransaction(error))throw error;}
 throw Error('Comparison page unavailable');
}
