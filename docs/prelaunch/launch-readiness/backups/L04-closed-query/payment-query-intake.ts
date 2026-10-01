import { createHash } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { createWechatChannel } from './wechat-channel.js';
import { registrationLock, dbNow, assertLease } from './domain.js';
import type { Lease } from '../jobs/queue.js';

// Internal trusted-query intake. Never accepts caller-supplied SUCCEEDED or paidAt.
// Facts remain RECEIVED until the formal qualification/refund processor applies them.
export function createPaymentQueryIntake(db: PrismaClient, channel: ReturnType<typeof createWechatChannel>) {
  return async (intentId: string, lease?: Lease) => {
    if (lease) {
      if (lease.refId !== intentId || lease.kind !== 'V11_QUERY_PAYMENT') throw Error('Query worker reference mismatch');
      await db.$transaction(tx => assertLease(tx, lease));
    }
    const initial = await db.v11PaymentIntent.findUniqueOrThrow({ where: { id: intentId } });
    const fact = await channel.queryPayment(initial);
    if (fact.status !== 'SUCCEEDED') return { kind: 'UNCONFIRMED' as const, status: fact.status };
    const payload = { kind: 'PAYMENT', sourceId: initial.id, merchantOrderNo: initial.merchantOrderNo,
      channelNo: fact.channelTradeNo!, amountCents: fact.amountCents, currency: fact.currency, paidAt: fact.paidAt! };
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return db.$transaction(async tx => {
      await registrationLock(tx, initial.registrationId);
      if (lease) await assertLease(tx, lease);
      const current = await tx.v11PaymentIntent.findUniqueOrThrow({ where: { id: intentId } });
      channel.assertBinding(current);
      if (current.registrationId !== initial.registrationId || current.merchantOrderNo !== initial.merchantOrderNo
        || current.totalCents !== fact.amountCents) throw Error('Payment identity changed during query');
      const source = 'wechat-query-v11'; const eventKey = `PAYMENT:${fact.channelTradeNo}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${source}:${current.merchantScope}:${eventKey}`},0))`;
      const key = { source, merchantScope: current.merchantScope, eventKey };
      const prior = await tx.receivedEvent.findUnique({ where: { source_merchantScope_eventKey: key } });
      if (prior) {
        if (prior.payloadHash !== payloadHash) {
          const conflictKey = { ...key, eventKey: `${eventKey}:conflict:${payloadHash}` };
          let conflict = await tx.receivedEvent.findUnique({ where: { source_merchantScope_eventKey: conflictKey } });
          if (!conflict) {
            conflict = await tx.receivedEvent.create({ data: { ...conflictKey, payloadHash, normalizedPayload: payload,
              verificationMaterialId: current.providerConfigId, verifiedAt: await dbNow(tx), state: 'MANUAL' } });
            await tx.auditLog.create({ data: { action: 'funding.v11-payment-query-conflict', targetType: 'ReceivedEvent', targetId: conflict.id,
              metadata: { scope: 'VERIFIED_CHANNEL_QUERY', originalEventId: prior.id, intentId: current.id } } });
          }
          return { kind: 'CONFLICT' as const, eventId: conflict.id, originalEventId: prior.id };
        }
        return { kind: 'RECEIVED' as const, eventId: prior.id };
      }
      const event = await tx.receivedEvent.create({ data: { ...key, payloadHash, normalizedPayload: payload,
        verificationMaterialId: current.providerConfigId, verifiedAt: await dbNow(tx), state: 'RECEIVED' } });
      await tx.auditLog.create({ data: { action: 'funding.v11-payment-query-received', targetType: 'ReceivedEvent', targetId: event.id,
        metadata: { scope: 'VERIFIED_CHANNEL_QUERY', intentId: current.id } } });
      // Cancellation/closed local intent does not discard actual money received.
      return { kind: 'RECEIVED' as const, eventId: event.id };
    });
  };
}
