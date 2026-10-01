import type { PrismaClient } from '../generated/prisma/client.js';
import type { createWechatChannel } from './wechat-channel.js';
import type { Lease } from '../jobs/queue.js';
import { retryJob } from '../jobs/queue.js';
import { createPaymentQueryIntake } from './payment-query-intake.js';
import { createPaymentReceiptLedger } from './payment-receipt-ledger.js';
import { createReceiptAllocator } from './receipt-allocation.js';
import { createRefundQueryConfirmation } from './refund-query-confirmation.js';

export function wechatQueryHandlers(db: PrismaClient, channel: ReturnType<typeof createWechatChannel>, caseOwner: string) {
  if (!caseOwner.trim()) throw Error('Financial case owner required');
  const intake = createPaymentQueryIntake(db, channel);
  const recordReceipt = createPaymentReceiptLedger(db, channel);
  const allocate = createReceiptAllocator(db, channel);
  const confirmRefund = createRefundQueryConfirmation(db, channel, caseOwner);
  return {
    V11_QUERY_REFUND: async (lease: Lease) => {
      const result = await confirmRefund(lease.refId, lease);
      if (result.kind === 'UNCONFIRMED') throw Error('Refund query still unconfirmed');
      if (result.kind === 'CONFLICT') await retryJob(db, lease, caseOwner, 'DATA_CONFLICT', true);
    },
    V11_QUERY_PAYMENT: async (lease: Lease) => {
      const result = await intake(lease.refId, lease);
      if (result.kind === 'UNCONFIRMED') throw Error('Payment query still unconfirmed');
      if (result.kind === 'CONFLICT') await retryJob(db, lease, caseOwner, 'DATA_CONFLICT', true);
      else if (result.kind === 'RECEIVED') {
        const receipt = await recordReceipt(result.eventId, lease);
        await allocate(receipt.receiptId, lease.refId, lease);
      }
    },
  };
}
