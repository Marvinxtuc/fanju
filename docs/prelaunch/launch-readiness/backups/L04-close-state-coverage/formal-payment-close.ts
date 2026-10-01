import type {PrismaClient} from '../generated/prisma/client.js';
import type {createWechatChannel} from './wechat-channel.js';
import type {Lease} from '../jobs/queue.js';
import {enqueue} from '../jobs/queue.js';
import {registrationLock,assertLease,dbNow,object} from './domain.js';

// Only committed absolute-expiry obligations can authorize this handler.
// Query recovery is committed before any network I/O; no local money state changes.
export function createFormalPaymentCloser(db:PrismaClient,channel:ReturnType<typeof createWechatChannel>){
 return async(lease:Lease)=>{
  if(lease.kind!=='V11_CLOSE_EXPIRED_PAYMENT'||lease.payloadVersion!==1)throw Error('Closure reference mismatch');
  const initial=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:lease.refId}});
  const check=async(record=false)=>db.$transaction(async tx=>{
   const reg=await registrationLock(tx,initial.registrationId);await assertLease(tx,lease);
   const intent=await tx.v11PaymentIntent.findUniqueOrThrow({where:{id:initial.id}});channel.assertBinding(intent);
   if(intent.active||intent.state!=='UNKNOWN'||intent.registrationId!==initial.registrationId||intent.merchantOrderNo!==initial.merchantOrderNo||intent.totalCents!==initial.totalCents||intent.merchantScope!==initial.merchantScope||intent.providerConfigId!==initial.providerConfigId
    ||reg.active||reg.eligibilityState!=='EXPIRED'||reg.category==='WAITLIST'||reg.paidEffectiveAt||reg.cancelAcceptedAt||intent.totalCents!==reg.serviceFeeCents+reg.depositCents)throw Error('Closure authority unavailable');
   const hold=await tx.v11SeatHold.findUnique({where:{registrationId:reg.id}}),now=await dbNow(tx);
   if(!hold||hold.state!=='EXPIRED'||!hold.releasedAt||hold.releasedAt<hold.expiresAt||hold.expiresAt>now||hold.expiresAt.getTime()!==reg.acceptedAt.getTime()+600000)throw Error('Closure expiry unavailable');
   const audit=await tx.auditLog.findFirst({where:{action:'qualification.v11-formal-hold-expired',targetType:'V11SeatHold',targetId:hold.id,metadata:{path:['effectiveDeadline'],equals:hold.expiresAt.toISOString()}}});
   const metadata=object(audit?.metadata),query=await tx.durableJob.findUnique({where:{businessKey:`v11:formal-expire-query:${intent.id}`}});
   if(metadata.scope!=='FROZEN_FORMAL_HOLD_EXPIRY_ONLY'||metadata.registrationId!==reg.id||metadata.channelClosed!==false||metadata.membershipChanged!==false||query?.kind!=='V11_QUERY_PAYMENT'||query.refId!==intent.id)throw Error('Closure committed evidence unavailable');
   const intents=await tx.v11PaymentIntent.findMany({where:{registrationId:reg.id},select:{id:true,channel:true,merchantScope:true,merchantOrderNo:true}});
   if(await tx.v11Membership.count({where:{registrationId:reg.id}})
    ||await tx.channelReceipt.count({where:{OR:intents.map(x=>({channel:x.channel,merchantScope:x.merchantScope,merchantOrderNo:x.merchantOrderNo}))}})
    ||await tx.receivedEvent.count({where:{source:'wechat-query-v11',merchantScope:intent.merchantScope,OR:intents.map(x=>({normalizedPayload:{path:['sourceId'],equals:x.id}}))}}))throw Error('Closure rights or money conflict');
   if(record){
    await enqueue(tx,'V11_QUERY_PAYMENT',`v11:close-recovery:${lease.id}:${lease.generation}`,intent.id);
    await tx.auditLog.create({data:{action:'funding.v11-expired-close-attempt',targetType:'DurableJob',targetId:lease.id,metadata:{scope:'FORMAL_EXPIRED_CLOSE_ATTEMPT_ONLY',intentId:intent.id,generation:lease.generation,channelClosed:false}}});
   }
  },{timeout:15000});
  await check(true);
  const fact=await channel.closePayment(initial,()=>check());
  // Persist another query after the channel call; the pre-I/O query may already
  // have run. SUCCEEDED is processed by existing receipt/allocation handlers.
  await db.$transaction(async tx=>{await registrationLock(tx,initial.registrationId);await assertLease(tx,lease);
   await enqueue(tx,'V11_QUERY_PAYMENT',`v11:close-result:${lease.id}:${lease.generation}`,initial.id);
   await tx.auditLog.create({data:{action:'funding.v11-expired-close-observed',targetType:'DurableJob',targetId:lease.id,metadata:{scope:'TRUSTED_CLOSE_QUERY_ONLY',intentId:initial.id,generation:lease.generation,status:fact.status}}});
  });
 };
}
