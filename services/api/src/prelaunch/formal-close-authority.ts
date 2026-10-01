import type {V11PaymentIntent,V11Registration} from '../generated/prisma/client.js';
import {dbNow,object,type Tx} from './domain.js';
import {isUnsettledPayment} from './unsettled-payment.js';
// Shared evidence check for scheduling and send-time fencing. No writes or I/O.
export async function hasFormalExpiryCloseAuthority(tx:Tx,reg:V11Registration,intent:V11PaymentIntent){
   if(intent.registrationId!==reg.id||intent.channel!=='wechat'||intent.active||!isUnsettledPayment(intent)
    ||reg.active||reg.eligibilityState!=='EXPIRED'||reg.category==='WAITLIST'||reg.paidEffectiveAt||reg.cancelAcceptedAt||intent.totalCents!==reg.serviceFeeCents+reg.depositCents)return false;
   const hold=await tx.v11SeatHold.findUnique({where:{registrationId:reg.id}}),now=await dbNow(tx);
   if(!hold||hold.state!=='EXPIRED'||!hold.releasedAt||hold.releasedAt<hold.expiresAt||hold.expiresAt>now||hold.expiresAt.getTime()!==reg.acceptedAt.getTime()+600000)return false;
   const audit=await tx.auditLog.findFirst({where:{action:'qualification.v11-formal-hold-expired',targetType:'V11SeatHold',targetId:hold.id,metadata:{path:['effectiveDeadline'],equals:hold.expiresAt.toISOString()}}});
   const metadata=object(audit?.metadata),query=await tx.durableJob.findUnique({where:{businessKey:`v11:formal-expire-query:${intent.id}`}});
   if(metadata.scope!=='FROZEN_FORMAL_HOLD_EXPIRY_ONLY'||metadata.registrationId!==reg.id||metadata.channelClosed!==false||metadata.membershipChanged!==false||query?.kind!=='V11_QUERY_PAYMENT'||query.refId!==intent.id)return false;
   const intents=await tx.v11PaymentIntent.findMany({where:{registrationId:reg.id},select:{id:true,channel:true,merchantScope:true,merchantOrderNo:true}});
   if(await tx.v11Membership.count({where:{registrationId:reg.id}})
    ||await tx.channelReceipt.count({where:{OR:intents.map(x=>({channel:x.channel,merchantScope:x.merchantScope,merchantOrderNo:x.merchantOrderNo}))}})
    ||await tx.receivedEvent.count({where:{source:'wechat-query-v11',merchantScope:intent.merchantScope,OR:intents.map(x=>({normalizedPayload:{path:['sourceId'],equals:x.id}}))}}))return false;
 return true;
}
