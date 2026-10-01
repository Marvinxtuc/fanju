import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({storage:new Map<string,unknown>(),request:vi.fn(),requestPayment:vi.fn()}));
vi.mock('../../../../apps/miniapp/node_modules/@tarojs/taro/index.js',()=>({default:{getStorageSync:(k:string)=>m.storage.get(k),setStorageSync:(k:string,v:unknown)=>m.storage.set(k,v),removeStorageSync:(k:string)=>m.storage.delete(k),request:m.request,requestPayment:m.requestPayment}}));
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();m.storage.clear();m.storage.set('fanju_session_v2','synthetic-session');vi.stubGlobal('__FANJU_API_BASE_URL__','https://api.example.invalid');vi.stubGlobal('__FANJU_DEMO_MODE__',false);m.request.mockImplementation(async x=>({statusCode:200,data:x.url.endsWith('/capabilities')?{version:'v11-identity-1',identityEnabled:true}:x.url.endsWith('/initialize')?{version:'v11-identity-1',principal:{id:'actor',userId:x.header.authorization?.includes('other')?'other':'user',personId:'person',version:1,role:'USER',restaurantId:null}}:x.url.endsWith('/consents')?{consentId:'consent',acceptedAt:new Date().toISOString()}: {registration:{id:'registration'}}}));});
it('formal response from old identity is discarded without clearing the new session',async()=>{
 const api=await import('../../../../apps/miniapp/src/api');let finish!:(v:unknown)=>void;
 const normal=m.request.getMockImplementation()!;m.request.mockImplementation(x=>x.url.endsWith('/late')?new Promise(resolve=>{finish=resolve;}):normal(x));
 const result=api.formalRequest('/late');await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));m.storage.set('fanju_session_v2','other-session');finish({statusCode:200,data:{private:'old'}});await expect(result).rejects.toThrow('登录状态已改变');expect(m.storage.get('fanju_session_v2')).toBe('other-session');
});
it('ambiguous signup response and module remount reuse exact consent and request key',async()=>{
 const api=await import('../../../../apps/miniapp/src/api');const normal=m.request.getMockImplementation()!;let attempts=0;
 m.request.mockImplementation(x=>{if(x.url.endsWith('/formal/registrations')&&++attempts===1)throw Error('Synthetic network ambiguity');return normal(x);});
 const offer={id:'activity',supplyId:'supply',policyId:'policy'} as any,terms={policyId:'policy',deliveryId:'delivery',fullHashes:{x:'hash'},publicHashes:{x:'public'}} as any;
 await expect(api.submitFormalSignup(offer,terms,'FORMAL','MALE')).rejects.toThrow('ambiguity');vi.resetModules();const reloaded=await import('../../../../apps/miniapp/src/api');await reloaded.submitFormalSignup(offer,terms,'FORMAL','MALE');
 const requests=m.request.mock.calls.map(c=>c[0]).filter(x=>x.url.endsWith('/formal/registrations'));expect(requests).toHaveLength(2);expect(requests[0].data).toEqual(requests[1].data);expect(m.request.mock.calls.filter(c=>c[0].url.endsWith('/consents'))).toHaveLength(1);
});
it('refund request key survives remount and separates server users',async()=>{
 const api=await import('../../../../apps/miniapp/src/api');const first=await api.formalRefundRequestKey('reg');vi.resetModules();const reloaded=await import('../../../../apps/miniapp/src/api');expect(await reloaded.formalRefundRequestKey('reg')).toBe(first);
 m.storage.set('fanju_session_v2','other-session');expect(await reloaded.formalRefundRequestKey('reg')).not.toBe(first);
});
it('malformed formal amount response cannot become a displayed valid offer',async()=>{
 const api=await import('../../../../apps/miniapp/src/api');m.request.mockResolvedValue({statusCode:200,data:{activity:{id:'activity',supplyId:'supply',policyId:'policy',title:'Menu',startsAt:new Date().toISOString(),serviceFeeCents:100,depositCents:200,totalCents:1,waitlistMax:null,mealCollection:'DIRECT_TO_RESTAURANT'}}});await expect(api.getFormalOffer('activity')).rejects.toThrow('活动报价资料不完整');
});
