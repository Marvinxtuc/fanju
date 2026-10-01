import {createHash,createSign,randomUUID,X509Certificate} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const repo=process.env.PRELAUNCH_SOURCE_ROOT;if(!repo)throw Error('Owned source required');
const require=createRequire(repo+'/services/api/package.json'),{PrismaPg}=require('@prisma/adapter-pg');
const {PrismaClient}=await import(pathToFileURL(repo+'/services/api/dist/generated/prisma/client.js'));
const {verifyOwnedDatabase}=await import(pathToFileURL(repo+'/services/api/dist/prelaunch/ownership.js'));
const {bindingFor}=await import(pathToFileURL(repo+'/services/api/dist/funding/intents.js'));
const {downloadWechatTradeBill}=await import(pathToFileURL(repo+'/services/api/dist/prelaunch/wechat-trade-bill.js'));
const {reconcileDownloadedWechatBill}=await import(pathToFileURL(repo+'/services/api/dist/prelaunch/wechat-bill-reconciliation.js'));
const {syntheticBill}=await import(pathToFileURL(repo+'/tests/prelaunch/fixtures/synthetic-bill.mjs'));
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});await verifyOwnedDatabase(db,process.env);
const dir=mkdtempSync(join(tmpdir(),'fanju-capacity-')),rows=[];const candidate=(await import(pathToFileURL(repo+'/scripts/prelaunch-candidate-hash.mjs'))).captureCandidate().candidate_id;
try{
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',dir+'/key.pem','-out',dir+'/cert.pem','-days','1','-subj','/CN=fanju-synthetic-capacity'],{stdio:'ignore'});
 const key=readFileSync(dir+'/key.pem','utf8'),cert=readFileSync(dir+'/cert.pem','utf8'),serial=new X509Certificate(cert).serialNumber;
 for(const count of [30000]){
  const id=randomUUID(),owner='capacity-'+id,env={WECHAT_PAY_ENABLED:'true',PAYMENT_PROVIDER:'wechat',REFUND_PROVIDER:'wechat',WECHAT_PAY_MCH_ID:'synthetic-'+id,WECHAT_MINIAPP_APP_ID:'synthetic-app',WECHAT_PAY_PRIVATE_KEY_PATH:'synthetic-private',WECHAT_PAY_PLATFORM_CERT_PATH:'synthetic-platform',WECHAT_PAY_CERT_SERIAL_NO:'synthetic-serial',WECHAT_PAY_CONFIG_VERSION:'synthetic-capacity'};
  const binding=bindingFor(env,'wechat'),raw=syntheticBill('2026-09-30',Array.from({length:count},(_,i)=>({kind:'PAYMENT',amountCents:100,orderNo:'synthetic-order-'+i,tradeNo:'synthetic-trade-'+i})),env.WECHAT_PAY_MCH_ID);
  const metadata=JSON.stringify({hash_type:'SHA1',hash_value:createHash('sha1').update(raw).digest('hex'),download_url:'https://api.mch.weixin.qq.com/v3/billdownload/file?token=fixture-bill'}),timestamp=String(Math.floor(Date.now()/1000)),nonce='synthetic-capacity';const signer=createSign('RSA-SHA256');signer.update(`${timestamp}\n${nonce}\n${metadata}\n`);signer.end();let calls=0;
  const bill=await downloadWechatTradeBill(env,'2026-09-30',{readFile:p=>p==='synthetic-private'?key:cert,fetch:async()=>++calls===1?new Response(metadata,{headers:{'wechatpay-timestamp':timestamp,'wechatpay-nonce':nonce,'wechatpay-serial':serial,'wechatpay-signature':signer.sign(key,'base64')}}):new Response(raw)});
  const began=performance.now();let result=null,failed=false,errorCode=null;
  try{result=await reconcileDownloadedWechatBill(db,env,bill,owner,'synthetic-capacity-release',id);}catch(error){failed=true;errorCode=error&&typeof error==='object'&&['P2028','P2034','P2002'].includes(error.code)?error.code:'OTHER';}
  const elapsedMs=Math.round(performance.now()-began);
  const events=await db.receivedEvent.findMany({where:{source:'wechat-bill-observation-v11',merchantScope:binding.merchantScope},select:{id:true}}),cases=await db.financialCase.count({where:{owner}}),audits=await db.auditLog.count({where:{action:'funding.v11-trade-bill-snapshot',targetId:id}});
  const invariant=failed?events.length===0&&cases===0&&audits===0:events.length===count&&cases===count&&audits===1&&result.differences===count;
  rows.push({rows:count,bytes:raw.length,elapsedMs,errorCode,status:failed?'REJECTED':'COMMITTED',events:events.length,cases,audits,atomicityVerified:invariant,coverageState:'INCOMPLETE'});
  console.log(JSON.stringify(rows.at(-1)));
  await db.financialCase.deleteMany({where:{owner,category:'V11_BILL_PAYMENT_WITHOUT_INTENT',sourceRef:{in:events.map(x=>x.id)}}});
  await db.receivedEvent.deleteMany({where:{source:'wechat-bill-observation-v11',merchantScope:binding.merchantScope,id:{in:events.map(x=>x.id)}}});
  await db.auditLog.deleteMany({where:{action:'funding.v11-trade-bill-snapshot',targetId:id}});await db.reconciliationBatch.deleteMany({where:{merchantScope:binding.merchantScope,period:'2026-09-30',sourceHash:'v11:'+bill.sourceSha256}});
  if(!invariant)throw Error('Capacity atomicity failed');
 }
 const report={candidate,status:'MEASURED_ENGINEERING_ONLY',environment:'OWNED_SYNTHETIC_POSTGRES',workload:'ALL_APPLICATION_PAYMENT_ROWS_WITHOUT_LOCAL_INTENTS',rows,releaseAuthorized:false,limits:['Local measurements only; not production capacity or merchant acceptance','No local intent/refund matching workload measured','Existing file/row and transaction limits retained'],scriptSha256:createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex')};
 writeFileSync(repo+'/docs/prelaunch/launch-readiness/L04_BILL_CORE_CAPACITY.json',JSON.stringify(report,null,2)+'\n');
}finally{await db.$disconnect();rmSync(dir,{recursive:true,force:true});}
