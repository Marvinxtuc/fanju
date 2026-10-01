import {evaluateCancellation,type CancellationReason,type PrelaunchTableState} from '@timeleft-shanghai/shared';
import type {PrismaClient} from '../generated/prisma/client.js';
import {registrationLock,dbNow,object,json,sha256,reserveWechatRefundBudget,type Tx} from './domain.js';
import {authorizeHistoricalPolicy,type RuntimeAuthoritySource} from './formal-runtime-policy.js';
import {verifyFormalActor} from './formal-supply.js';
import {requireRole,requireOwner,reject,type LocalPrincipal} from './contracts.js';
import type {createWechatChannel} from './wechat-channel.js';
import {refreshFormalTable} from './formal-qualification.js';
import {createRefundDispatcher} from './refund-dispatch.js';
import {createRefundQueryConfirmation} from './refund-query-confirmation.js';
import {assertLease} from './domain.js';
import type {Lease} from '../jobs/queue.js';
import {enqueue,openCase} from '../jobs/queue.js';
import {formalCanonicalJson} from './formal-json.js';
import {acceptOwnRefundRequest} from './refund-request-intake.js';

export function nextFormalRefundBatch(at:Date,minutes:readonly number[]){
 if(!minutes.length||minutes.some(m=>!Number.isInteger(m)||m<0||m>1439))throw Error('Explicit refund batch required');
 const midnight=Date.UTC(at.getUTCFullYear(),at.getUTCMonth(),at.getUTCDate());
 const candidates=minutes.map(m=>midnight+m*60000).filter(t=>t>=at.getTime());
 return new Date(candidates.length?Math.min(...candidates):midnight+86400000+Math.min(...minutes)*60000);
}
export async function refreshFormalRefundProgress(tx:Tx,registrationId:string){
 const requests=await tx.v11Request.findMany({where:{registrationId,kind:{in:['FORMAL_REFUND_APPLICATION','FORMAL_MANDATORY_REFUND']},state:{in:['WAITING_BATCH','REFUND_PROCESSING']}}});
 for(const request of requests){
  const decision=await tx.v11Decision.findFirst({where:{requestId:request.id,kind:'FORMAL_REFUND_DECISION'}}),ids=object(decision?.payload).instructionIds;
  if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'))continue;
  const rows=await tx.v11RefundInstruction.findMany({where:{id:{in:ids as string[]},registrationId}});
  if(rows.length!==ids.length)throw Error('Formal refund instruction provenance incomplete');
  const state=rows.every(row=>row.state==='CONFIRMED')?'REFUND_CONFIRMED':rows.some(row=>row.state!=='WAITING_BATCH')?'REFUND_PROCESSING':'WAITING_BATCH';
  if(state==='REFUND_CONFIRMED')await tx.financialCase.updateMany({where:{sourceRef:request.id,category:{in:['V11_FORMAL_REFUND_RECEIPT_REVIEW','V11_FORMAL_REFUND_REVIEW']},state:{not:'RESOLVED'}},data:{state:'RESOLVED',resolution:sha256(formalCanonicalJson({requestId:request.id,instructionIds:ids,state})),reviewedBy:'VERIFIED_CHANNEL_QUERY',reviewedAt:await dbNow(tx)}});
  if(state!==request.state){await tx.v11Request.update({where:{id:request.id},data:{state,version:{increment:1}}});await tx.auditLog.create({data:{action:'refund.v11-formal-request-progress',targetType:'V11Request',targetId:request.id,metadata:{state,instructionIds:ids}}});}
 }
}
export function formalRefundService(db:PrismaClient,source:RuntimeAuthoritySource,channel:ReturnType<typeof createWechatChannel>,owner:string){
 if(!owner.trim())throw Error('Formal refund owner required');
 async function authorizeInstruction(tx:Tx,instructionId:string){
  const instruction=await tx.v11RefundInstruction.findUniqueOrThrow({where:{id:instructionId}});
  if(!instruction.registrationId)reject(409,'FORMAL_REFUND_REGISTRATION_REQUIRED');
  const reg=await registrationLock(tx,instruction.registrationId);
  const runtime=await authorizeHistoricalPolicy(tx,reg.policyId,'EXECUTE_REFUND',source);channel.assertBinding(runtime.binding);channel.assertBinding(instruction);
  const audit=await tx.auditLog.findFirst({where:{action:'refund.v11-formal-instruction-authorized',targetType:'V11RefundInstruction',targetId:instructionId}});
  const proof=object(audit?.metadata);
  const decision=typeof proof.decisionId==='string'?await tx.v11Decision.findUnique({where:{id:proof.decisionId},include:{request:true}}):null;
  const payload=object(decision?.payload);
  if(!decision||decision.kind!=='FORMAL_REFUND_DECISION'||proof.decisionDigest!==sha256(formalCanonicalJson(decision.payload))
   ||decision.request.registrationId!==reg.id||payload.policyDigest!==reg.policy.bundleDigest||payload.parameterDigest!==runtime.binding.parameterDigest
   ||!Array.isArray(payload.instructionIds)||!payload.instructionIds.includes(instructionId)||typeof payload.batchAt!=='string'
   ||Date.parse(payload.batchAt)>(await dbNow(tx)).getTime()||instruction.totalCents!==instruction.serviceFeeCents+instruction.depositCents)
   reject(409,'FORMAL_REFUND_EXECUTION_EVIDENCE_INVALID');
  return {instruction,decision,runtime};
 }
 const dispatch=createRefundDispatcher(db,channel,async(tx,id)=>{await authorizeInstruction(tx,id);});
 const confirm=createRefundQueryConfirmation(db,channel,owner);
 return {
  async accept(actor:LocalPrincipal,registrationId:string,key:string){
   return acceptOwnRefundRequest(db,actor,registrationId,key,true,async(tx,request)=>{
    const reg=await registrationLock(tx,registrationId);
    const acceptedMember=await tx.v11Membership.findUnique({where:{registrationId},include:{table:true}});
    await tx.auditLog.create({data:{action:'refund.v11-formal-acceptance-rights',targetType:'V11Request',targetId:request.id,metadata:{registrationId,acceptedAt:request.acceptedAt.toISOString(),tableId:acceptedMember?.tableId??null,tableState:acceptedMember?.table.state==='UNFORMED'?'WAITING':acceptedMember?.table.state??'WAITING',category:reg.category,activeMember:acceptedMember?.active??false,policyDigest:reg.policy.bundleDigest}}});
    let runtime;
    try{runtime=await authorizeHistoricalPolicy(tx,reg.policyId,'DECIDE_REFUND',source);channel.assertBinding(runtime.binding);}
    catch{
     const issue=await openCase(tx,'V11_FORMAL_MEMBER_REMOVAL_AUTHORITY',request.id,owner);
     await tx.financialCase.update({where:{id:issue.id},data:{deadline:new Date(request.acceptedAt.getTime()+24*3600000)}});return;
    }
    if(runtime.parameters.memberRemovalEvent!=='REQUEST_ACCEPTED')return;
    const member=await tx.v11Membership.findUnique({where:{registrationId}});
    // Member exit is distinct from refund amount approval and channel execution.
    if(member?.active){
     await tx.v11Membership.update({where:{id:member.id},data:{active:false,leftAt:request.acceptedAt}});
     await tx.v11Registration.update({where:{id:reg.id},data:{active:false,eligibilityState:'ENDED',cancelAcceptedAt:reg.cancelAcceptedAt??request.acceptedAt,version:{increment:1}}});
     await refreshFormalTable(tx,member.tableId,request.acceptedAt);
     await enqueue(tx,'V11_FORMAL_LIFECYCLE','v11:formal-intake-promotion:'+request.id,reg.id);
     await tx.auditLog.create({data:{action:'refund.v11-formal-member-exit-at-intake',targetType:'V11Request',targetId:request.id,metadata:{registrationId,memberId:member.id,acceptedAt:request.acceptedAt.toISOString(),authorityId:runtime.grant.id,parameterDigest:runtime.binding.parameterDigest}}});
    }
   });
  },
  async query(actor:LocalPrincipal,registrationId:string){
   await db.$transaction(async tx=>{const reg=await registrationLock(tx,registrationId);await verifyFormalActor(tx,actor);requireOwner(actor,reg.userId);});
   const rows=await db.v11RefundInstruction.findMany({where:{registrationId},orderBy:{id:'asc'},take:50});
   const results=[];for(const row of rows){channel.assertBinding(row);results.push({instructionId:row.id,...await confirm(row.id)});}
   await db.$transaction(async tx=>{await registrationLock(tx,registrationId);await refreshFormalRefundProgress(tx,registrationId);});
   return {registrationId,results,newMoneySubmitted:false};
  },
  async decide(actor:LocalPrincipal,requestId:string){
   requireRole(actor,'OPS');
   return db.$transaction(async tx=>{
    const initial=await tx.v11Request.findUniqueOrThrow({where:{id:requestId}});if(!initial.registrationId)reject(409,'FORMAL_REFUND_REGISTRATION_REQUIRED');
    const reg=await registrationLock(tx,initial.registrationId);await verifyFormalActor(tx,actor);
    await tx.$queryRaw`SELECT id FROM "V11Request" WHERE id=${requestId} FOR UPDATE`;
    const request=await tx.v11Request.findUniqueOrThrow({where:{id:requestId}});
    if(!((request.kind==='FORMAL_REFUND_APPLICATION'&&request.source==='FORMAL_USER_INTAKE')
     ||(request.kind==='FORMAL_MANDATORY_REFUND'&&request.source==='FORMAL_BUSINESS_ROUTE'))||request.userId!==reg.userId)reject(409,'FORMAL_REFUND_REQUEST_INVALID');
    const runtime=await authorizeHistoricalPolicy(tx,reg.policyId,'DECIDE_REFUND',source);channel.assertBinding(runtime.binding);
    const prior=await tx.v11Decision.findFirst({where:{requestId,kind:'FORMAL_REFUND_DECISION'}});if(prior){await refreshFormalRefundProgress(tx,reg.id);const current=await tx.v11Request.findUniqueOrThrow({where:{id:requestId}});return {decisionId:prior.id,...object(prior.payload),state:current.state};}
    const mandatory=request.kind==='FORMAL_MANDATORY_REFUND';const input=object(request.payload);
    const audit=mandatory?await tx.auditLog.findFirst({where:{action:'refund.v11-known-obligation',targetType:'V11Request',targetId:requestId}}):null;
    if(mandatory&&(!audit||formalCanonicalJson(audit.metadata)!==formalCanonicalJson(request.payload)
     ||!['LATE_RECEIPT','FORMATION_FAILED','EXTRA_PAYMENT'].includes(String(input.reason))))reject(409,'FORMAL_REFUND_OBLIGATION_INVALID');
    const member=await tx.v11Membership.findUnique({where:{registrationId:reg.id},include:{table:true}});
    const lastEvent=member?await tx.v11TableEvent.findFirst({where:{tableId:member.tableId,acceptedAt:{lte:request.acceptedAt}},orderBy:[{acceptedAt:'desc'},{version:'desc'}]}):null;
    const rightsAudit=mandatory?null:await tx.auditLog.findFirst({where:{action:'refund.v11-formal-acceptance-rights',targetType:'V11Request',targetId:requestId}});
    const rights=object(rightsAudit?.metadata);
    if(rightsAudit&&(rights.registrationId!==reg.id||rights.acceptedAt!==request.acceptedAt.toISOString()||rights.policyDigest!==reg.policy.bundleDigest))reject(409,'FORMAL_REFUND_HISTORY_UNAVAILABLE');
    const historicalState=rightsAudit?rights.tableState:lastEvent?object(lastEvent.snapshot).state:'WAITING';
    if(!['WAITING','FORMED','INVALIDATED','FAILED'].includes(String(historicalState)))reject(409,'FORMAL_REFUND_HISTORY_UNAVAILABLE');
    const historicalCategory=rightsAudit?rights.category:reg.category;
    const reason:CancellationReason=mandatory?(input.reason==='FORMATION_FAILED'?'FORMATION_FAILED':'LATE_RECEIPT'):'VOLUNTARY';
    const decision=evaluateCancellation({startAt:reg.activity.startsAt.getTime(),acceptedAt:request.acceptedAt.getTime(),
     membership:historicalCategory==='WAITLIST'?'WAITLIST':'FORMAL',category:historicalCategory==='LATE_FORMED'?'LATE_FORMED':historicalCategory==='ORDINARY'?'ORDINARY':'UNRESOLVED',
     tableState:historicalState as PrelaunchTableState,funding:{F:reg.serviceFeeCents,D:reg.depositCents},reason});
    const blockers=new Set(decision.blockerIds);
    if(!mandatory&&member?.active&&runtime.parameters.memberRemovalEvent===null)blockers.add('OP-04');
    if(runtime.parameters.refundBatchUtcMinutes===null||runtime.parameters.refundDispatchSlaSeconds===null)blockers.add('OP-11');
    if(decision.status!=='READY'||!decision.effect||blockers.size){
     await tx.v11Request.update({where:{id:requestId},data:{state:'BLOCKED_PARAMETERS',blockerIds:json([...blockers]),version:{increment:1}}});
     return {requestId,state:'BLOCKED_PARAMETERS',code:decision.code,blockerIds:[...blockers],acceptedAt:request.acceptedAt};
    }
    // The original accepted time selects rights; execution clock only selects batch.
    const at=await dbNow(tx),batchAt=nextFormalRefundBatch(at,runtime.parameters.refundBatchUtcMinutes!);
    const receipts=await tx.v11ReceiptBinding.findMany({where:{registrationId:reg.id,...(mandatory?{receiptId:String(input.receiptId)}:{})},include:{receipt:true,intent:true}});
    if(!receipts.length){
     const intents=await tx.v11PaymentIntent.findMany({where:{registrationId:reg.id}});
     for(const intent of intents){channel.assertBinding(intent);await enqueue(tx,'V11_QUERY_PAYMENT',`v11:formal-refund-receipt-query:${requestId}:${intent.id}`,intent.id);}
     await tx.auditLog.upsert({where:{id:'v11_followup_'+sha256(requestId).slice(0,40)},update:{},create:{id:'v11_followup_'+sha256(requestId).slice(0,40),action:'refund.v11-formal-receipt-followup-authorized',targetType:'V11Request',targetId:requestId,metadata:{actorId:actor.id,personId:actor.personId,actorVersion:actor.version,policyDigest:reg.policy.bundleDigest,parameterDigest:runtime.binding.parameterDigest,authorityId:runtime.grant.id,acceptedAt:request.acceptedAt.toISOString()}}});
     const issue=await openCase(tx,'V11_FORMAL_REFUND_RECEIPT_REVIEW',requestId,owner);
     await tx.financialCase.update({where:{id:issue.id},data:{deadline:new Date(request.acceptedAt.getTime()+24*3600000)}});
     await tx.v11Request.update({where:{id:requestId},data:{state:'AWAITING_TRUSTED_RECEIPT',blockerIds:[],version:{increment:1}}});
     return {requestId,state:'AWAITING_TRUSTED_RECEIPT',acceptedAt:request.acceptedAt};
    }
    const ids:string[]=[],settlementIds:string[]=[],retentionIds:string[]=[];
    for(const allocation of receipts){
     if(!allocation.intent||!['PRIMARY','EXTRA'].includes(allocation.classification)||allocation.receipt.channel!=='wechat'
      ||allocation.receipt.merchantOrderNo!==allocation.intent.merchantOrderNo||allocation.receipt.amountCents!==allocation.intent.totalCents||!allocation.receipt.paidAt)reject(409,'FORMAL_REFUND_RECEIPT_INVALID');
     channel.assertBinding(allocation.intent);
     const desired=allocation.classification==='EXTRA'?{F:reg.serviceFeeCents,D:reg.depositCents}:{F:decision.effect.refundF,D:decision.effect.refundD};
     const instruction=await reserveWechatRefundBudget(tx,reg,allocation.receiptId,desired,`formal-refund:${requestId}:${allocation.receiptId}`,allocation.intent,batchAt);
     if(instruction)ids.push(instruction.id);
     // Preserve non-refund dispositions separately from revenue recognition and
     // restaurant payout. Neither is fabricated by refund approval.
     const components=await tx.v11FundComponent.findMany({where:{receiptId:allocation.receiptId},orderBy:{id:'asc'}});
     for(const component of components){
      await tx.$queryRaw`SELECT id FROM "V11FundComponent" WHERE id=${component.id} FOR UPDATE`;
      const used=await tx.v11Disposition.aggregate({where:{componentId:component.id,state:{not:'RELEASED'}},_sum:{amountCents:true}});
      const remaining=component.originalCents-(used._sum.amountCents??0);if(remaining<=0)continue;
      const compensation=allocation.classification==='PRIMARY'&&component.kind==='D'&&decision.effect.depositDisposition==='RESTAURANT_COMPENSATION';
      const businessKey=`formal-retained:${requestId}:${component.id}`;
      const disposition=await tx.v11Disposition.create({data:{componentId:component.id,businessKey,kind:compensation?'RESTAURANT_COMPENSATION':'RETAINED',amountCents:remaining,
       state:compensation?'RESERVED':'RECOGNITION_BLOCKED',sourceRef:requestId}});retentionIds.push(disposition.id);
      if(compensation){const obligation=await tx.v11SettlementObligation.create({data:{registrationId:reg.id,componentId:component.id,businessKey,
       amountCents:remaining,state:'AWAITING_SETTLEMENT_AUTHORITY',sourceRef:requestId}});settlementIds.push(obligation.id);}
     }
    }
    // Exact member-removal clock is configured; absent values above block this branch.
    if(!mandatory){
     const removeAt=runtime.parameters.memberRemovalEvent==='REQUEST_ACCEPTED'?request.acceptedAt:at;
     await tx.v11Registration.update({where:{id:reg.id},data:{active:false,eligibilityState:'ENDED',cancelAcceptedAt:reg.cancelAcceptedAt??request.acceptedAt,version:{increment:1}}});
     if(member?.active){await tx.v11Membership.update({where:{id:member.id},data:{active:false,leftAt:removeAt}});await refreshFormalTable(tx,member.tableId,removeAt);
      // Promotion failure is recorded separately; it cannot roll back owed money.
      await enqueue(tx,'V11_FORMAL_LIFECYCLE',`v11:formal-promotion:${requestId}`,reg.id);}
    }
    const payload={scope:'FORMAL_REFUND_DECISION',requestId,acceptedAt:request.acceptedAt.toISOString(),reason,ruleCode:decision.code,
     entitlement:decision.effect,policyDigest:reg.policy.bundleDigest,parameterDigest:runtime.binding.parameterDigest,authorityId:runtime.grant.id,
     instructionIds:ids,settlementIds,retentionIds,batchAt:batchAt.toISOString(),dispatchDeadline:new Date(batchAt.getTime()+runtime.parameters.refundDispatchSlaSeconds!*1000).toISOString(),
     state:ids.length?'WAITING_BATCH':'NO_ADDITIONAL_REFUND'};
    const row=await tx.v11Decision.create({data:{requestId,actorId:actor.id,personId:actor.personId,kind:'FORMAL_REFUND_DECISION',payload:json(payload)}});
    for(const id of ids)await tx.auditLog.create({data:{action:'refund.v11-formal-instruction-authorized',targetType:'V11RefundInstruction',targetId:id,
     metadata:{decisionId:row.id,decisionDigest:sha256(formalCanonicalJson(payload)),authorityId:runtime.grant.id}}});
    await tx.v11Request.update({where:{id:requestId},data:{state:payload.state,blockerIds:[],version:{increment:1}}});
    return {decisionId:row.id,...payload};
   });
  },
  handlers:{
   V11_WECHAT_REFUND:async(lease:Lease)=>{
    await db.$transaction(async tx=>{
     const initial=await tx.v11RefundInstruction.findUniqueOrThrow({where:{id:lease.refId}});if(initial.registrationId)await registrationLock(tx,initial.registrationId);
     await assertLease(tx,lease);const {instruction,decision}=await authorizeInstruction(tx,lease.refId);
     if(instruction.state==='WAITING_BATCH')await tx.v11RefundInstruction.update({where:{id:instruction.id},data:{state:'NEW',version:{increment:1}}});
     const deadline=Date.parse(String(object(decision.payload).dispatchDeadline));
     if((await dbNow(tx)).getTime()>deadline)await tx.auditLog.upsert({where:{id:'v11_sla_'+sha256(instruction.id).slice(0,40)},update:{},create:{id:'v11_sla_'+sha256(instruction.id).slice(0,40),action:'refund.v11-dispatch-sla-breached',targetType:'V11RefundInstruction',targetId:instruction.id,metadata:{owner,deadline:new Date(deadline).toISOString()}}});
    });
    await dispatch(lease.refId,lease);
    await db.$transaction(async tx=>{const row=await tx.v11RefundInstruction.findUniqueOrThrow({where:{id:lease.refId}});if(row.registrationId){await registrationLock(tx,row.registrationId);await refreshFormalRefundProgress(tx,row.registrationId);}});
   },
   V11_QUERY_REFUND:async(lease:Lease)=>{const result=await confirm(lease.refId,lease);if(result.kind==='CONFIRMED')await db.$transaction(async tx=>{const row=await tx.v11RefundInstruction.findUniqueOrThrow({where:{id:lease.refId}});if(row.registrationId){await registrationLock(tx,row.registrationId);await refreshFormalRefundProgress(tx,row.registrationId);}});if(result.kind!=='CONFIRMED')throw Error('Formal refund query unresolved');},
  },
 };
}
