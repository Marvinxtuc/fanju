import type { PrismaClient } from '../generated/prisma/client.js';
import type { BoundPayment } from './wechat-channel.js';

// Internal persistence seam. The formal route must authorize owner/policy/hold under
// its registration lock before claiming; a merchant number is never replaced on retry.
export function createPaymentPreparationStore(db: PrismaClient) {
  return {
    async claim(input: BoundPayment & { id: string; preparationVersion: number }) {
      return db.$transaction(async tx => {
        const current = await tx.v11PaymentIntent.findUniqueOrThrow({ where: { id: input.id } });
        if (current.channel !== 'wechat' || current.channel !== input.channel || current.merchantScope !== input.merchantScope
          || current.providerConfigId !== input.providerConfigId || current.merchantOrderNo !== input.merchantOrderNo
          || current.totalCents !== input.totalCents) throw Error('Payment preparation binding conflict');
        if (!current.active || !['NEW','SUBMITTING','UNKNOWN'].includes(current.state)) throw Error('Payment intent unavailable');
        const updated = await tx.v11PaymentIntent.updateMany({
          where: { id: current.id, preparationVersion: input.preparationVersion, preparationState: 'NOT_STARTED', active: true,
            state: { in: ['NEW','SUBMITTING','UNKNOWN'] } },
          data: { preparationState: 'SUBMITTING', preparationVersion: { increment: 1 } },
        });
        if (updated.count !== 1) throw Error('Payment preparation already claimed; query existing merchant number');
        return tx.v11PaymentIntent.findUniqueOrThrow({ where: { id: input.id } });
      });
    },
    async savePrepared(id: string, version: number, prepayId: string) {
      if (!prepayId || prepayId.length > 256) throw Error('Invalid prepayment reference');
      const changed = await db.v11PaymentIntent.updateMany({ where: { id, preparationVersion: version, preparationState: 'SUBMITTING' },
        data: { preparationState: 'PREPARED', prepayId, preparationVersion: { increment: 1 } } });
      if (changed.count !== 1) throw Error('Stale preparation result; query merchant number');
    },
    async markUnknown(id: string, version: number) {
      await db.v11PaymentIntent.updateMany({ where: { id, preparationVersion: version, preparationState: 'SUBMITTING' },
        data: { preparationState: 'UNKNOWN', preparationVersion: { increment: 1 } } });
    },
  };
}
