import {createHash} from 'node:crypto';
import {billRangeDays,summarizeWechatBillRange} from './wechat-bill-range.js';
import type {PrismaClient} from '../generated/prisma/client.js';
import type {ChannelBinding} from '../funding/mock-channel.js';
export async function hasCommittedBillDay(db:PrismaClient,binding:ChannelBinding,owner:string,release:string,date:string,runId:string){
 const rows=await db.auditLog.findMany({where:{action:'funding.v11-trade-bill-snapshot',targetType:'V11TradeBillRun',targetId:runId},select:{metadata:true}});
 if(!rows.length)return false;
 if(rows.length!==1)throw Error('Ambiguous recovery evidence');
 const metadata=rows[0]!.metadata as unknown as {identity:{owner:string;sourceSha256:string};result:{runId:string}};
 if(metadata?.identity?.owner!==owner||! /^[a-f0-9]{64}$/.test(metadata.identity.sourceSha256)||metadata.result?.runId!==runId||summarizeWechatBillRange(binding,release,date,date,[metadata]).observedDays!==1)throw Error('Recovery identity conflict');
 return true;
}
export function billDayRunId(rangeId:string,date:string){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(rangeId))throw Error('Explicit range UUID required');
 billRangeDays(date,date);
 const h=createHash('sha256').update(JSON.stringify(['v11-bill-range-1',rangeId,date])).digest('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
// Committed audit evidence is the recovery checkpoint. A failed day is never
// interpreted as an empty bill. Errors are deliberately excluded from output.
export async function runWechatBillRange(start:string,end:string,rangeId:string,operations:{resume:(date:string,runId:string)=>Promise<boolean>;compare:(date:string,runId:string)=>Promise<void>;recordFailure?:(date:string,runId:string)=>Promise<void>}){
 const dates=billRangeDays(start,end),runs=dates.map(date=>({date,runId:billDayRunId(rangeId,date)}));
 const days:Array<{date:string;status:'RESUMED'|'OBSERVED'|'FAILED'}>=[];
 for(const {date,runId} of runs){
  try{if(await operations.resume(date,runId))days.push({date,status:'RESUMED'});
   else{await operations.compare(date,runId);days.push({date,status:'OBSERVED'});}}
  catch{if(operations.recordFailure)await operations.recordFailure(date,runId);days.push({date,status:'FAILED'});}
 }
 return {start,end,days,failedDays:days.filter(x=>x.status==='FAILED').length,coverageState:'INCOMPLETE',releaseAuthorized:false};
}
