import { createHash } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import { reject, requireRole, type LocalPrincipal } from './contracts.js';
import { dbNow, registrationLock, type Tx } from './domain.js';

const source='FORMAL_USER_INTAKE';
const kind='FORMAL_REFUND_APPLICATION';
const projection=(row:{id:string;registrationId:string|null;acceptedAt:Date;state:string})=>({
  requestId:row.id,registrationId:row.registrationId,acceptedAt:row.acceptedAt,state:row.state,
  scope:'REQUEST_INTAKE_ONLY',refundApproved:false,policyActivation:'NOT_ASSESSED',
});
// No refund instruction, cancellation, membership mutation, simulated notice or job.
export async function acceptOwnRefundRequest(db:PrismaClient,actor:LocalPrincipal,registrationId:string,key:string,formalProcessing=false,onAccepted?:(tx:Tx,request:{id:string;registrationId:string|null;acceptedAt:Date})=>Promise<void>){
 requireRole(actor,'USER');if(!actor.userId)reject(403,'FORBIDDEN');
 const businessKey='formal-refund:'+createHash('sha256').update(JSON.stringify([actor.userId,registrationId,key])).digest('hex');
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "V11Actor" WHERE id=${actor.id} FOR SHARE`;
  const current=await tx.v11Actor.findUnique({where:{id:actor.id}});
  if(!current||!current.enabled||current.version!==actor.version||current.role!=='USER'||current.userId!==actor.userId||current.personId!==actor.personId)reject(401,'SESSION_EXPIRED');
  const reg=await tx.v11Registration.findFirst({where:{id:registrationId,userId:actor.userId!},select:{id:true,policy:{select:{status:true}}}});
  if(!reg)reject(404,'RESOURCE_NOT_FOUND');
  if(formalProcessing&&reg.policy.status!=='FORMAL_RUNTIME')reject(409,'FORMAL_RUNTIME_POLICY_REQUIRED');
  if(formalProcessing)await registrationLock(tx,registrationId);
  else await tx.$queryRaw`SELECT id FROM "V11Registration" WHERE id=${registrationId} FOR UPDATE`;
  const prior=await tx.v11Request.findUnique({where:{businessKey}});
  if(prior){if(prior.source!==source||prior.kind!==kind||prior.userId!==actor.userId||prior.registrationId!==registrationId)reject(409,'REQUEST_IDEMPOTENCY_CONFLICT');return projection(prior);}
  const request=await tx.v11Request.create({data:{businessKey,registrationId,userId:actor.userId,kind,source,
   acceptedAt:await dbNow(tx),state:formalProcessing?'ACCEPTED':'BLOCKED_POLICY',blockerIds:formalProcessing?[]:['OP-04','OP-10','OP-11','RV-02'],payload:{scope:'REQUEST_INTAKE_ONLY',refundApproved:false}}});
  await tx.auditLog.create({data:{action:'v11.formal_refund_request_accepted',targetType:'V11Request',targetId:request.id,
   metadata:{scope:'REQUEST_INTAKE_ONLY',actorId:actor.id,personId:actor.personId}}});
  if(onAccepted)await onAccepted(tx,request);
  return projection(request);
 });
}
export async function ownRefundRequest(db:PrismaClient,actor:LocalPrincipal,id:string){
 requireRole(actor,'USER');if(!actor.userId)reject(403,'FORBIDDEN');
 const row=await db.v11Request.findFirst({where:{id,userId:actor.userId,source,kind}});
 if(!row)reject(404,'RESOURCE_NOT_FOUND');return projection(row);
}

export async function ownMoneyRegistrations(db:PrismaClient,actor:LocalPrincipal,cursor?:string){
 requireRole(actor,'USER');if(!actor.userId)reject(403,'FORBIDDEN');
 return db.$transaction(async tx=>{
  const rows=await tx.v11Registration.findMany({where:{userId:actor.userId!,...(cursor?{id:{gt:cursor}}:{})},select:{id:true,activity:{select:{title:true,startsAt:true}}},orderBy:{id:'asc'},take:21});
  const page=rows.slice(0,20);
  const registrations=[];
  for(const row of page){
   const latest=await tx.v11Request.findFirst({where:{userId:actor.userId,source,kind,registrationId:row.id},orderBy:[{acceptedAt:'desc'},{id:'desc'}]});
   registrations.push({registrationId:row.id,activityTitle:row.activity.title,startsAt:row.activity.startsAt,refundRequests:latest?[projection(latest)]:[]});
  }
  return {registrations,nextCursor:rows.length>20?page.at(-1)!.id:null};
 },{isolationLevel:'RepeatableRead'});
}
