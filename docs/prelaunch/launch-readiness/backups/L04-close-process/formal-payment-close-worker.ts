import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../generated/prisma/client.js';
import {createWechatProviders} from '../providers.js';
import {createWechatChannel} from './wechat-channel.js';
import {createFormalPaymentCloser} from './formal-payment-close.js';
import {runOne} from '../jobs/queue.js';
import {recordWorkerPoll} from '../jobs/heartbeat.js';
async function main(){
 const env=process.env;
 if(process.argv.slice(2).some(x=>x!=='--once')||env.FEATURE_V11_FORMAL_PAYMENT_CLOSE!=='true'||env.FEATURE_V11_QUERY_RECOVERY!=='true'||env.PAYMENT_PROVIDER!=='wechat'||env.REFUND_PROVIDER!=='wechat'||!env.DATABASE_URL||!env.FINANCIAL_CASE_OWNER?.trim()||!env.RELEASE_VERSION?.trim())throw Error('Explicit formal closure configuration required');
 const providers=createWechatProviders(env),channel=createWechatChannel(env,providers.payment,providers.refund),db=new PrismaClient({adapter:new PrismaPg({connectionString:env.DATABASE_URL})}),owner=randomUUID();
 let stopping=false,timer:ReturnType<typeof setTimeout>|undefined;
 const stop=()=>{if(stopping)return;stopping=true;timer=setTimeout(()=>process.exit(1),15000);timer.unref();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{const handlers={V11_CLOSE_EXPIRED_PAYMENT:createFormalPaymentCloser(db,channel)};do{
  const worked=await runOne(db,owner,env.FINANCIAL_CASE_OWNER,handlers,['V11_CLOSE_EXPIRED_PAYMENT']);await recordWorkerPoll(db,'v11-formal-payment-close',owner,env.RELEASE_VERSION);
  if(process.argv.includes('--once'))break;if(!worked&&!stopping)await delay(250);
 }while(!stopping);}finally{if(timer)clearTimeout(timer);process.off('SIGINT',stop);process.off('SIGTERM',stop);await db.$disconnect();}
}
main().catch(()=>{console.error('Formal closure worker unavailable; query recovery remains required');process.exitCode=1;});
