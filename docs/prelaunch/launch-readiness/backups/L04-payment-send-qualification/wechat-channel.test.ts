import { describe, expect, it, vi } from 'vitest';
import { createWechatChannel } from './wechat-channel.js';
import { bindingFor } from '../funding/intents.js';
import type { PaymentProvider, RefundProvider, ChannelPaymentResult } from '../providers.js';
const env={WECHAT_PAY_MCH_ID:'synthetic-merchant',WECHAT_MINIAPP_APP_ID:'synthetic-app'};
const input={...bindingFor(env,'wechat'),merchantOrderNo:'order-test',totalCents:100};
const paid={merchantOrderNo:'order-test',status:'SUCCEEDED' as const,amountCents:100,currency:'CNY' as const,channelTradeNo:'trade-test',paidAt:'2026-10-01T01:00:00Z'};
function setup() {
  const query=vi.fn<(id:string)=>Promise<ChannelPaymentResult>>().mockResolvedValue(paid);
  const create=vi.fn().mockResolvedValue({channel:'wechat',prepayId:'prepay-test',paymentParams:{appId:env.WECHAT_MINIAPP_APP_ID,timeStamp:'1790816400',nonceStr:'nonce-test',package:'prepay_id=prepay-test',signType:'RSA',paySign:'synthetic-signature'}});
  const close=vi.fn().mockResolvedValue(undefined);
  const refundQuery=vi.fn().mockResolvedValue({merchantRefundNo:'refund-test',status:'PENDING',channelRefundNo:'channel-refund',originalTradeNo:'trade-test',amountCents:50,currency:'CNY'});
  const payment={mode:'wechat',queryPayment:query,createPayment:create,closePayment:close} as unknown as PaymentProvider;
  const refund={mode:'wechat',queryRefund:refundQuery} as unknown as RefundProvider;
  return {query,create,close,refundQuery,payment,refund,channel:createWechatChannel(env,payment,refund)};
}
describe('bound real channel',()=>{
  it('keeps prepayment distinct from a receipt',async()=>{
    const {query,channel}=setup();query.mockResolvedValue({merchantOrderNo:'order-test',status:'NOT_FOUND'});
    const result=await channel.preparePayment(input,'synthetic-openid');expect(result.kind).toBe('PREPARED');expect(result).not.toHaveProperty('status');
  });
  it('does not create another order for existing pending payment',async()=>{
    const {query,create,channel}=setup();query.mockResolvedValue({...paid,status:'PENDING'});
    expect((await channel.preparePayment(input,'synthetic-openid')).kind).toBe('EXISTING');expect(create).not.toHaveBeenCalled();
  });
  it.each([{...input,merchantScope:'other'},{...input,totalCents:-1},{...input,providerConfigId:'other'}])('rejects binding before network %j',async bad=>{
    const {query,channel}=setup();await expect(channel.queryPayment(bad)).rejects.toThrow();expect(query).not.toHaveBeenCalled();
  });
  it.each([{...paid,amountCents:101},{...paid,merchantOrderNo:'other'},{...paid,paidAt:undefined}])('rejects mismatched payment fact %j',async bad=>{
    const {query,channel}=setup();query.mockResolvedValue(bad);await expect(channel.queryPayment(input)).rejects.toThrow();
  });
  it('recovers payment winning a close race',async()=>{
    const {query,close,channel}=setup();query.mockResolvedValueOnce({...paid,status:'PENDING'});close.mockRejectedValue(Error('channel close rejected'));
    expect(await channel.closePayment(input)).toEqual(paid);
  });
  it('does not invent closed state for an absent merchant number',async()=>{
    const {query,close,channel}=setup();query.mockResolvedValue({merchantOrderNo:'order-test',status:'NOT_FOUND'});
    await expect(channel.closePayment(input)).rejects.toThrow('closure not established');expect(close).not.toHaveBeenCalled();
  });
  it('requires query evidence after successful close request',async()=>{
    const {query,channel}=setup();query.mockResolvedValue({...paid,status:'PENDING'});await expect(channel.closePayment(input)).rejects.toThrow('unknown');
  });
  it('checks original refund transaction',async()=>{
    const {channel}=setup();await expect(channel.queryRefund({...input,merchantRefundNo:'refund-test',originalTradeNo:'other',totalCents:50})).rejects.toThrow();
  });
  it('rejects mixed mock providers',()=>{
    const {payment,refund}=setup();expect(()=>createWechatChannel(env,{...payment,mode:'mock'},refund)).toThrow();
  });
  it('does not dispatch a new prepayment after unknown query failure',async()=>{
    const {query,create,channel}=setup();query.mockRejectedValue(Error('network timeout'));
    await expect(channel.preparePayment(input,'synthetic-openid')).rejects.toThrow();expect(create).not.toHaveBeenCalled();
  });
  it('rejects missing or foreign prepayment parameters',async()=>{
    const {query,create,channel}=setup();query.mockResolvedValue({merchantOrderNo:'order-test',status:'NOT_FOUND'});
    create.mockResolvedValue({channel:'wechat',prepayId:'prepay-test',paymentParams:{appId:'other-app'}});
    await expect(channel.preparePayment(input,'synthetic-openid')).rejects.toThrow();
  });
});
