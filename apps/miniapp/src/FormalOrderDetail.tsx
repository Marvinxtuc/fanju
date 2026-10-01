import {useEffect,useRef,useState} from 'react';
import {View,Text,Button} from '@tarojs/components';
import {useDidShow,useDidHide,useRouter,navigateTo} from '@tarojs/taro';
import {formalRequest,formalRefundRequestKey,beginNewFormalAttempt,prepareFormalPayment,type FormalRegistrationDetail} from './api';
export function FormalOrderDetail():JSX.Element{
 const id=useRouter().params.id??'';const [record,setRecord]=useState<FormalRegistrationDetail|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const generation=useRef(0),pending=useRef(false);
 useEffect(()=>()=>{generation.current++;pending.current=false;},[]);
 useDidShow(()=>{generation.current++;setRecord(null);setError('');pending.current=false;void run(load);});
 useDidHide(()=>{generation.current++;setRecord(null);setMessage('');setError('');});
 async function load(){if(!id)throw Error('请选择报名记录');const epoch=generation.current;const result=await formalRequest<{registration:FormalRegistrationDetail}>('/api/v11/formal/registrations/'+encodeURIComponent(id));if(generation.current===epoch)setRecord(result.registration);}
 async function run(action:()=>Promise<void>){if(pending.current)return;pending.current=true;const epoch=generation.current;setBusy(true);setError('');try{await action();}catch(e){if(generation.current===epoch)setError(e instanceof Error?e.message:'处理未完成，请刷新记录');}finally{if(generation.current===epoch){pending.current=false;setBusy(false);}}}
 async function pay(){await prepareFormalPayment(id);await load();}
 async function query(){const results=await Promise.allSettled(['/payment/query','/refunds/query'].map(suffix=>formalRequest('/api/v11/formal/registrations/'+encodeURIComponent(id)+suffix,{method:'POST'})));await load();if(results.some(result=>result.status==='rejected'))throw Error('部分渠道查询暂未完成，已保存记录仍可查看，请稍后重试');}
 async function applyRefund(){const epoch=generation.current;const request=await formalRequest<{acceptedAt:string;state:string}>('/api/v11/formal/registrations/'+encodeURIComponent(id)+'/refund-requests',{method:'POST',data:{businessKey:await formalRefundRequestKey(id)}});
  if(generation.current===epoch)setMessage('申请已受理，受理时间：'+request.acceptedAt+'。退款金额按原受理时刻与规则判定。');await load();}
 return <View className="page"><Text className="title">{record?.title??'我的报名'}</Text>{error&&<Text className="error-text">{error}</Text>}{message&&<Text>{message}</Text>}
  {record&&<><Text>报名状态：{record.state}</Text><Text>F 服务费：¥{(record.F/100).toFixed(2)}；D 保证金：¥{(record.D/100).toFixed(2)}；合计：¥{(record.total/100).toFixed(2)}</Text>
   <Text>受理时间：{record.acceptedAt}</Text>{record.holdExpiresAt&&record.state==='PENDING_PAYMENT'&&<Text>占位截止：{record.holdExpiresAt}</Text>}
   <Text>餐厅：{record.restaurantName??'按成团规则解锁'}</Text><Text>地址：{record.address??'在有效成团及规定时间后解锁'}</Text>
   {record.refunds.map(r=><View key={r.id}><Text>退款：¥{(r.total/100).toFixed(2)}；{r.state==='CONFIRMED'?'渠道已确认退回':'尚待渠道确认'}</Text></View>)}
   {record.requests.filter(r=>r.kind.includes('REFUND')).map(r=><View key={r.id}><Text>申请：{r.state}；原受理：{r.acceptedAt}</Text>{r.blockerIds.length>0&&<Text>相关规则尚待明确，原申请已保留。</Text>}</View>)}
   {['ENDED','EXPIRED'].includes(record.state)&&<Button disabled={busy} onClick={()=>void run(async()=>{const activityId=await beginNewFormalAttempt(record);await navigateTo({url:'/pages/activity-detail/index?id='+encodeURIComponent(activityId)});})}>重新阅读规则并申请报名</Button>}
   <Button disabled={busy||record.state!=='PENDING_PAYMENT'} onClick={()=>void run(pay)}>继续支付</Button><Button disabled={busy} onClick={()=>void run(applyRefund)}>申请取消及退款</Button></>}
  <Button disabled={busy||!id} onClick={()=>void run(load)}>刷新报名</Button><Button disabled={busy||!record} onClick={()=>void run(query)}>核对收款与退款进度</Button>
  <Button onClick={()=>navigateTo({url:'/pages/mock-auth/index'})}>登录与授权</Button><Button onClick={()=>navigateTo({url:'/pages/money-records/index'})}>历史资金记录</Button>
 </View>;
}
export function FormalOrderList():JSX.Element{
 const [rows,setRows]=useState<FormalRegistrationDetail[]>([]),[cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const generation=useRef(0),pending=useRef(false);useDidShow(()=>{generation.current++;pending.current=false;setRows([]);setCursor(null);void load();});useDidHide(()=>{generation.current++;setRows([]);setCursor(null);});
 async function load(next?:string){if(pending.current)return;pending.current=true;const epoch=generation.current;setBusy(true);setError('');try{const data=await formalRequest<{registrations:FormalRegistrationDetail[];nextCursor:string|null}>('/api/v11/formal/registrations'+(next?'?cursor='+encodeURIComponent(next):''));if(epoch===generation.current){setRows(previous=>next?[...previous,...data.registrations]:data.registrations);setCursor(data.nextCursor);}}catch(e){if(epoch===generation.current){setRows([]);setCursor(null);setError(e instanceof Error?e.message:'报名查询未完成');}}finally{if(epoch===generation.current){pending.current=false;setBusy(false);}}}
 return <View className="page"><Text className="title">我的报名</Text>{error&&<Text className="error-text">{error}</Text>}<Button disabled={busy} onClick={()=>void load()}>刷新报名记录</Button>
  {rows.map(r=><View key={r.id}><Text>{r.title} · {r.state}</Text><Text>F ¥{(r.F/100).toFixed(2)}；D ¥{(r.D/100).toFixed(2)}；合计 ¥{(r.total/100).toFixed(2)}</Text><Button onClick={()=>navigateTo({url:'/pages/order-detail/index?id='+encodeURIComponent(r.id)})}>查看报名及退款</Button></View>)}
  {cursor&&<Button disabled={busy} onClick={()=>void load(cursor)}>下一页</Button>}<Button onClick={()=>navigateTo({url:'/pages/money-records/index'})}>历史资金记录</Button>
 </View>;
}
