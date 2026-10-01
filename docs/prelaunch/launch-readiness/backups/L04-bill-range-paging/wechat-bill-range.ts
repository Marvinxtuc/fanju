import type {PrismaClient} from '../generated/prisma/client.js';
import type {ChannelBinding} from '../funding/mock-channel.js';
const version='v11-bill-snapshot-3';
function day(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Invalid bill range date');const at=Date.parse(value+'T00:00:00Z');if(!Number.isFinite(at)||new Date(at).toISOString().slice(0,10)!==value)throw Error('Invalid bill range date');return at;}
export function billRangeDays(start:string,end:string){const first=day(start),last=day(end);if(last<first||last-first>365*86400000)throw Error('Bill range must contain 1 to 366 days');const dates:string[]=[];for(let at=first;at<=last;at+=86400000)dates.push(new Date(at).toISOString().slice(0,10));return dates;}
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
// Audit snapshot ordinal, not wall-clock order, defines the latest observation.
// No runtime policy or release authority; even an all-present range is incomplete.
export function summarizeWechatBillRange(binding:ChannelBinding,releaseVersion:string,start:string,end:string,metadata:unknown[]){
 if(binding.channel!=='wechat'||!/^[a-f0-9]{64}$/.test(binding.merchantScope)||!binding.providerConfigId||!releaseVersion.trim())throw Error('Explicit bill range binding required');
 const expected=billRangeDays(start,end);
 const reports=expected.map(date=>{
  const candidates=metadata.map(object).filter(row=>{const identity=object(row.identity);return identity.billDate===date&&object(identity.binding).merchantScope===binding.merchantScope;});
  if(!candidates.length)return {date,status:'MISSING',differences:null};
  // An older success never replaces an unsupported/newer observation.
  if(candidates.some(row=>typeof row.decisionOrdinal!=='string'||!/^[1-9]\d{0,18}$/.test(row.decisionOrdinal as string)))return {date,status:'UNSUPPORTED_ORDERING',differences:null};
  const sorted=candidates.sort((a,b)=>BigInt(a.decisionOrdinal as string)>BigInt(b.decisionOrdinal as string)?-1:1);
  const latest=sorted[0]!,identity=object(latest.identity),originalBinding=object(identity.binding),result=object(latest.result);
  if(sorted.length>1&&latest.decisionOrdinal===sorted[1]!.decisionOrdinal)return {date,status:'AMBIGUOUS_ORDERING',differences:null};
  if(identity.releaseVersion!==releaseVersion||identity.comparisonVersion!==version||originalBinding.channel!==binding.channel||originalBinding.providerConfigId!==binding.providerConfigId)return {date,status:'VERSION_MISMATCH',differences:null};
  if(result.billDate!==date||result.scope!=='BILL_AND_RECORDED_FUNDS_SNAPSHOT'||result.coverageState!=='INCOMPLETE'||result.releaseAuthorized!==false||!Number.isSafeInteger(result.differences)||Number(result.differences)<0)return {date,status:'INVALID_EVIDENCE',differences:null};
  return {date,status:'INCOMPLETE',differences:Number(result.differences)};
 });
 return {scope:'REQUESTED_BILL_RANGE_ONLY',start,end,expectedDays:expected.length,missingDays:reports.filter(x=>x.status==='MISSING').length,
  observedDays:reports.filter(x=>x.status==='INCOMPLETE').length,days:reports,coverageState:'INCOMPLETE',releaseAuthorized:false};
}
export async function inspectWechatBillRange(db:PrismaClient,binding:ChannelBinding,releaseVersion:string,start:string,end:string){
 billRangeDays(start,end);
 return db.$transaction(async tx=>{
  const rows=await tx.auditLog.findMany({where:{action:'funding.v11-trade-bill-snapshot',targetType:'V11TradeBillRun',metadata:{path:['identity','binding','merchantScope'],equals:binding.merchantScope}},select:{metadata:true}});
  return summarizeWechatBillRange(binding,releaseVersion,start,end,rows.map(x=>x.metadata));
 },{isolationLevel:'RepeatableRead'});
}
