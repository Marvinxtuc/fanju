import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../generated/prisma/client.js';
import {bindingFor} from '../funding/intents.js';
import {downloadWechatTradeBill} from './wechat-trade-bill.js';
import {reconcileDownloadedWechatBill} from './wechat-bill-reconciliation.js';
import {billRangeDays} from './wechat-bill-range.js';
import {billDayRunId,runWechatBillRange,hasCommittedBillDay} from './wechat-bill-range-runner.js';
import {ensureWechatBillRangeTask,recordWechatBillRangeFailure} from './wechat-bill-range-journal.js';
async function main(){
 const [start,end,rangeId,...extra]=process.argv.slice(2),env=process.env;
 if(extra.length||!start||!end||!rangeId||env.FEATURE_V11_BILL_RANGE_RUN!=='true'||env.FEATURE_V11_BILL_RECONCILIATION!=='true'||env.FEATURE_V11_QUERY_RECOVERY!=='true'||!env.DATABASE_URL||!env.FINANCIAL_CASE_OWNER?.trim()||!env.RELEASE_VERSION?.trim())throw Error('Explicit range execution configuration required');
 billRangeDays(start,end);billDayRunId(rangeId,start);
 const binding=bindingFor(env,'wechat'),owner=env.FINANCIAL_CASE_OWNER,release=env.RELEASE_VERSION;
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:env.DATABASE_URL})});
 try{
  const task={rangeId,start,end,binding,owner,releaseVersion:release};
  await ensureWechatBillRangeTask(db,task);
  const result=await runWechatBillRange(start,end,rangeId,{
   resume:(date,runId)=>hasCommittedBillDay(db,binding,owner,release,date,runId),
   compare:async(date,runId)=>{const bill=await downloadWechatTradeBill(env,date);await reconcileDownloadedWechatBill(db,env,bill,owner,release,runId);},
   recordFailure:(date,runId)=>recordWechatBillRangeFailure(db,task,date,runId)
  });
  console.log(JSON.stringify(result));if(result.failedDays)process.exitCode=2;
 }finally{await db.$disconnect();}
}
main().catch(()=>{console.error('Bill range execution failed; no completeness conclusion recorded');process.exitCode=1;});
