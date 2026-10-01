// @vitest-environment jsdom
import React from '../../apps/ops/node_modules/react/index.js';
import {createRoot,type Root} from '../../apps/ops/node_modules/react-dom/client.js';
import {act} from '../../apps/ops/node_modules/react-dom/test-utils.js';
import {it,expect,vi} from 'vitest';
const bridge=vi.hoisted(()=>({storage:new Map<string,unknown>(),paths:[] as string[],params:{id:process.env.FORMAL_ACTIVITY_ID!},navigation:'',origin:process.env.FORMAL_ORIGIN!}));
vi.mock('../../apps/miniapp/node_modules/@tarojs/taro/index.js',async()=>{const r=await import('../../apps/ops/node_modules/react/index.js');const navigateTo=async({url}:{url:string})=>{bridge.navigation=url;};return{default:{getCurrentInstance:()=>({router:{params:bridge.params}}),getStorageSync:(k:string)=>bridge.storage.get(k),setStorageSync:(k:string,v:unknown)=>bridge.storage.set(k,v),requestPayment:async()=>{},request:async(x:{url:string;method:string;header:Record<string,string>;data?:unknown})=>{const path=new URL(x.url).pathname+new URL(x.url).search;bridge.paths.push(path);const res=await fetch(bridge.origin+path,{method:x.method,headers:x.header,...(x.data===undefined?{}:{body:JSON.stringify(x.data)})});return{statusCode:res.status,data:await res.json()};}},navigateTo,useRouter:()=>({params:bridge.params}),useDidShow:(f:()=>void)=>r.useEffect(f,[]),useDidHide:()=>{}};});
vi.mock('../../apps/miniapp/node_modules/@tarojs/components/dist/index.js',async()=>{const r=await import('../../apps/ops/node_modules/react/index.js');const wrap=(tag:string)=>(p:Record<string,unknown>)=>r.createElement(tag,p,p.children as React.ReactNode);return{View:wrap('div'),ScrollView:wrap('div'),Text:wrap('span'),Button:wrap('button'),Input:wrap('input'),Textarea:wrap('textarea'),Switch:(p:{checked:boolean;disabled:boolean;onChange:Function})=>r.createElement('input',{type:'checkbox',checked:p.checked,disabled:p.disabled,onChange:(e:Event)=>p.onChange({detail:{value:(e.target as HTMLInputElement).checked}})})};});
let root:Root,box:HTMLDivElement;
async function mount(Page:React.ComponentType<any>,props={}){box=document.createElement('div');document.body.append(box);root=createRoot(box);await act(async()=>root.render(React.createElement(Page,props)));}
async function unmount(){await act(async()=>root.unmount());box.remove();}
async function wait(predicate:()=>boolean,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){await act(async()=>{await new Promise(r=>setTimeout(r,40));});if(predicate())return;}throw Error('Formal main-page HTTP convergence timed out');}
function button(label:string){const scoped=['批准此供给及报价','发布此活动供给','按原申请时刻核定退款','加入这一桌'].includes(label);return [...box.querySelectorAll('button')].find(x=>x.textContent===label&&(!scoped||x.closest('article,.meal-card')?.textContent?.includes(process.env.FORMAL_ACTIVITY_ID!)));}
async function click(label:string){
 const paged=['批准此供给及报价','发布此活动供给','按原申请时刻核定退款'].includes(label);
 if(paged)for(let page=0;page<100;page++){
  await wait(()=>!!button('刷新正式业务记录')&&!button('刷新正式业务记录')!.disabled);
  if(button(label))break;
  const next=button('加载下一页正式业务记录');if(!next)throw Error('Formal record missing across available pages: '+label+'; '+box.textContent);
  await act(async()=>next.click());
 }
 await wait(()=>!!button(label)&&!button(label)!.disabled);await act(async()=>button(label)!.click());}
async function field(label:string,value:string){const input=[...box.querySelectorAll('label')].find(l=>l.textContent?.startsWith(label))!.querySelector('input')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});}
it('actual main activity/order and controlled ops components use formal HTTP supply/signup/receipt/refund routes and recover after remount',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('__FANJU_DEMO_MODE__',false);vi.stubGlobal('__FANJU_FORMAL_BUSINESS__',true);vi.stubGlobal('__FANJU_API_BASE_URL__',bridge.origin);vi.stubGlobal('__FANJU_PRELAUNCH_ENABLED__',false);
 const {createControlledIdentityClient}=await import('../../apps/ops/src/controlled-identity-api.js');const {FormalBusinessWorkspace}=await import('../../apps/ops/src/FormalBusinessWorkspace.js');
 const transport=async(path:string,options:RequestInit)=>{bridge.paths.push(path);const res=await fetch(bridge.origin+path,options);return{status:res.status,data:await res.json()};};
 const client=createControlledIdentityClient(transport);const restaurant=await client.login(process.env.FORMAL_RESTAURANT_USERNAME!,process.env.FORMAL_PASSWORD!);
 await mount(FormalBusinessWorkspace,{client,identity:restaurant,onSessionLost:()=>{throw Error('Unexpected controlled session loss');}});
 try{
  await field('活动编号',process.env.FORMAL_ACTIVITY_ID!);await field('政策版本编号',process.env.FORMAL_POLICY_ID!);await field('D 保证金', '200');await click('提交餐厅供给');await wait(()=>box.textContent!.includes('供给申请：'));
 }finally{await unmount();}
 client.logout();const ops=await client.login(process.env.FORMAL_OPS_USERNAME!,process.env.FORMAL_PASSWORD!);await mount(FormalBusinessWorkspace,{client,identity:ops,onSessionLost:()=>{throw Error('Unexpected controlled session loss');}});
 try{await click('刷新正式业务记录');await wait(()=>box.textContent!.includes('批准此供给及报价'));await click('批准此供给及报价');await click('发布此活动供给');await wait(()=>box.textContent!.includes('活动已按此供给发布'));}finally{await unmount();}
 bridge.storage.set('fanju_session_v2',process.env.FORMAL_USER_TOKEN!);
 const Activity=(await import('../../apps/miniapp/src/pages/activity-detail/index.js')).default,Order=(await import('../../apps/miniapp/src/pages/order-detail/index.js')).default;
 const Home=(await import('../../apps/miniapp/src/pages/home/index.js')).default;await mount(Home);try{for(let page=0;page<100&&!box.textContent!.includes(process.env.FORMAL_ACTIVITY_ID!);page++){await wait(()=>box.textContent!.includes(process.env.FORMAL_ACTIVITY_ID!)||!!button('下一页活动'));if(box.textContent!.includes(process.env.FORMAL_ACTIVITY_ID!))break;await click('下一页活动');await wait(()=>!button('下一页活动')?.disabled);}await wait(()=>box.textContent!.includes(process.env.FORMAL_ACTIVITY_ID!));expect(box.textContent).toContain('保证金 D 2 元；合计 3 元');await click('加入这一桌');expect(bridge.navigation).toContain('/pages/activity-detail/index?id='+process.env.FORMAL_ACTIVITY_ID);}finally{await unmount();}
 await mount(Activity);try{
  await wait(()=>box.textContent!.includes('本次合计：¥3.00'));await click('阅读报名协议与退款规则');await wait(()=>box.querySelectorAll('input[type=checkbox]').length===3);
  await click('男性');await act(async()=>box.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(x=>x.click()));await click('提交报名并锁定报价');await wait(()=>bridge.navigation.includes('/pages/order-detail/index?id='));
 }finally{await unmount();}
 const id=new URL('http://owned'+bridge.navigation).searchParams.get('id')!;bridge.params={id};await mount(Order);
 try{await wait(()=>box.textContent!.includes('报名状态：PENDING_PAYMENT'));await click('继续支付');await wait(()=>box.textContent!.includes('报名状态：FORMAL'));expect(box.textContent).not.toContain('合成受限地址');await click('申请取消及退款');await wait(()=>box.textContent!.includes('申请已受理'));}finally{await unmount();}
 await mount(FormalBusinessWorkspace,{client,identity:ops,onSessionLost:()=>{throw Error('Unexpected controlled session loss');}});
 try{await click('刷新正式业务记录');await wait(()=>box.textContent!.includes('按原申请时刻核定退款'));await click('按原申请时刻核定退款');await wait(()=>box.textContent!.includes('退款处理：'));expect(box.textContent).toContain('WAITING_BATCH');}finally{await unmount();}
 // Clear all client state and reauthenticate: recover original server record.
 bridge.storage.clear();bridge.storage.set('fanju_session_v2',process.env.FORMAL_USER_TOKEN!);await mount(Order);
 try{await wait(()=>box.textContent!.includes('F 服务费：¥1.00'));const deadline=Date.now()+70000;while(Date.now()<deadline&&!box.textContent!.includes('渠道已确认退回')){await click('核对收款与退款进度');await wait(()=>![...box.querySelectorAll('button')].find(x=>x.textContent==='刷新报名')!.disabled);if(!box.textContent!.includes('渠道已确认退回'))await act(async()=>{await new Promise(r=>setTimeout(r,300));});}expect(box.textContent).toContain('渠道已确认退回');expect(bridge.paths.some(p=>p.includes('/api/prelaunch/'))).toBe(false);expect(bridge.paths.some(p=>p.endsWith('/payment/prepare'))).toBe(true);expect(bridge.paths.some(p=>p.endsWith('/decide'))).toBe(true);}finally{await unmount();client.logout();vi.unstubAllGlobals();}
},100000);
