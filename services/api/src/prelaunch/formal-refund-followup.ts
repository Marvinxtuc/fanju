import type {PrismaClient} from '../generated/prisma/client.js';
import type {ChannelBinding} from '../funding/mock-channel.js';
import {object,registrationLock,dbNow,sha256} from './domain.js';
import {authorizeHistoricalPolicy,type RuntimeAuthoritySource} from './formal-runtime-policy.js';
import {openCase} from '../jobs/queue.js';
import {formalRefundService} from './formal-refund-service.js';
/** Follow-up is bounded and has an assigned 24h case. Absence of a receipt is
 * never proof of zero money. Known obligations require explicit auto-decision. */
export async function followupFormalRefundBatch(db:PrismaClient,source:RuntimeAuthoritySource,binding:ChannelBinding,
 service:ReturnType<typeof formalRefundService>,owner:string,afterId?:string){
 const actor=await db.v11Actor.findUniqueOrThrow({where:{id:owner}});if(actor.role!=='OPS'||!actor.enabled)throw Error('Active formal refund OPS owner required');
 const rows=await db.v11Request.findMany({where:{...(afterId?{id:{gt:afterId}}:{}),kind:{in:['FORMAL_MANDATORY_REFUND','FORMAL_REFUND_APPLICATION']},state:{in:['ACCEPTED','BLOCKED_PARAMETERS','AWAITING_TRUSTED_RECEIPT','AWAITING_MANUAL_DECISION','AWAITING_ACTION_AUTHORITY']},registration:{policy:{status:'FORMAL_RUNTIME'},v11PaymentIntent_registrationId:{some:{channel:binding.channel,merchantScope:binding.merchantScope,providerConfigId:binding.providerConfigId}}}},orderBy:{id:'asc'},take:50});
 let decided=0,blocked=0;
 for(const request of rows){
  try {
  const permitted=await db.$transaction(async tx=>{
   const reg=await registrationLock(tx,request.registrationId!);
   let runtime;try{runtime=await authorizeHistoricalPolicy(tx,reg.policyId,'DECIDE_REFUND',source);}catch{
    const issue=await openCase(tx,'V11_FORMAL_HISTORICAL_AUTHORITY_REVIEW',request.id,owner);await tx.financialCase.update({where:{id:issue.id},data:{deadline:new Date(request.acceptedAt.getTime()+24*3600000)}});
    if(request.state!=='AWAITING_ACTION_AUTHORITY')await tx.v11Request.update({where:{id:request.id},data:{state:'AWAITING_ACTION_AUTHORITY',version:{increment:1}}});return false;
   }

   if(request.state==='AWAITING_TRUSTED_RECEIPT'){
    const intents=await tx.v11PaymentIntent.findMany({where:{registrationId:reg.id}});
    let verified=intents.length>0&&intents.every(i=>!i.active);
    for(const intent of intents){
     const event=await tx.receivedEvent.findUnique({where:{source_merchantScope_eventKey:{source:'wechat-closed-query-v11',merchantScope:intent.merchantScope,eventKey:'PAYMENT_CLOSED:'+intent.id}}}),p=object(event?.normalizedPayload);
     if(!event||event.state==='MANUAL'||event.verificationMaterialId!==intent.providerConfigId||p.kind!=='PAYMENT_CLOSED'||p.sourceId!==intent.id||p.merchantOrderNo!==intent.merchantOrderNo||p.amountCents!==intent.totalCents||p.currency!=='CNY'||event.payloadHash!==sha256(JSON.stringify({kind:p.kind,sourceId:p.sourceId,merchantOrderNo:p.merchantOrderNo,amountCents:p.amountCents,currency:p.currency})))verified=false;
     const audit=event?await tx.auditLog.findFirst({where:{action:'funding.v11-closed-query-converged',targetType:'ReceivedEvent',targetId:event.id}}):null;
     const proof=object(audit?.metadata);
     if(proof.scope!=='CHANNEL_CLOSURE_OBSERVATION_ONLY'||proof.intentId!==intent.id
      ||await tx.receivedEvent.count({where:{source:'wechat-query-v11',merchantScope:intent.merchantScope,normalizedPayload:{path:['sourceId'],equals:intent.id}}})>0
      ||await tx.receivedEvent.count({where:{source:'wechat-closed-query-v11',merchantScope:intent.merchantScope,eventKey:{startsWith:'PAYMENT_CLOSED:'+intent.id+':conflict:'},state:'MANUAL'}})>0)verified=false;
    }
    if(verified&&await tx.v11ReceiptBinding.count({where:{registrationId:reg.id}})===0&&await tx.channelReceipt.count({where:{OR:intents.map(i=>({channel:i.channel,merchantScope:i.merchantScope,merchantOrderNo:i.merchantOrderNo}))}})===0){
     await tx.financialCase.updateMany({where:{sourceRef:request.id,category:{in:['V11_FORMAL_REFUND_RECEIPT_REVIEW','V11_FORMAL_REFUND_REVIEW','V11_FORMAL_HISTORICAL_AUTHORITY_REVIEW','V11_FORMAL_REFUND_FOLLOWUP_FAILURE']},state:{not:'RESOLVED'}},data:{state:'RESOLVED',resolution:sha256(JSON.stringify({requestId:request.id,intentIds:intents.map(i=>i.id),state:'NO_FUNDS_CHANNEL_CLOSED'})),reviewedBy:'VERIFIED_CHANNEL_QUERY',reviewedAt:await dbNow(tx)}});
     await tx.v11Request.update({where:{id:request.id},data:{state:'NO_FUNDS_CHANNEL_CLOSED',blockerIds:[],version:{increment:1}}});
     await tx.auditLog.create({data:{action:'refund.v11-formal-no-funds-channel-closed',targetType:'V11Request',targetId:request.id,metadata:{acceptedAt:request.acceptedAt.toISOString(),intentIds:intents.map(i=>i.id),receiptCount:0,originalChannelVerified:true}}});
     return false;
    }
   }
   const at=await dbNow(tx),issue=await openCase(tx,'V11_FORMAL_REFUND_REVIEW',request.id,owner);
   await tx.financialCase.update({where:{id:issue.id},data:{deadline:new Date(request.acceptedAt.getTime()+24*3600000)}});
   const followup=await tx.auditLog.findFirst({where:{action:'refund.v11-formal-receipt-followup-authorized',targetType:'V11Request',targetId:request.id}}),proof=object(followup?.metadata);
   const allowed=request.kind==='FORMAL_MANDATORY_REFUND'?runtime.parameters.automaticObligationDecision===true:proof.actorId===actor.id&&proof.actorVersion===actor.version&&proof.policyDigest===reg.policy.bundleDigest&&proof.parameterDigest===runtime.binding.parameterDigest;
   if(!allowed&&request.kind==='FORMAL_MANDATORY_REFUND'&&request.state!==(runtime.parameters.automaticObligationDecision===null?'BLOCKED_PARAMETERS':'AWAITING_MANUAL_DECISION'))await tx.v11Request.update({where:{id:request.id},data:{state:runtime.parameters.automaticObligationDecision===null?'BLOCKED_PARAMETERS':'AWAITING_MANUAL_DECISION',blockerIds:runtime.parameters.automaticObligationDecision===null?['OP-11']:[],version:{increment:1}}});
   if(at.getTime()>=request.acceptedAt.getTime()+24*3600000)await tx.auditLog.upsert({where:{id:'v11_review_sla_'+request.id},update:{},create:{id:'v11_review_sla_'+request.id,action:'refund.v11-review-sla-breached',targetType:'V11Request',targetId:request.id,metadata:{caseId:issue.id,owner,deadline:new Date(request.acceptedAt.getTime()+24*3600000).toISOString()}}});
   return allowed;
  });
  if(permitted){await service.decide({...actor,role:'OPS'},request.id);decided++;}else blocked++;
  } catch {
   // One damaged history or undecidable branch must not starve other requests.
   // Preserve original request/decision and assign an explicit recovery case.
   const issue=await openCase(db,'V11_FORMAL_REFUND_FOLLOWUP_FAILURE',request.id,owner);
   await db.financialCase.update({where:{id:issue.id},data:{deadline:new Date(request.acceptedAt.getTime()+24*3600000)}});
   blocked++;
  }
 }
 return {decided,blocked,nextCursor:rows.length===50?rows[49]!.id:null};
}
