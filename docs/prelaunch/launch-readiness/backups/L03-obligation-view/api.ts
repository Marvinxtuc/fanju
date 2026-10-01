import Taro from "@tarojs/taro";

declare const __FANJU_API_BASE_URL__: string;
declare const __FANJU_DEMO_MODE__: boolean;

export const demoModeEnabled = __FANJU_DEMO_MODE__;

const API_BASE_URL = __FANJU_API_BASE_URL__;
const TOKEN_KEY = "fanju_session_v2";
const LAST_ORDER_ID_KEY = "timeleft_last_order_id";
let pendingLogin: Promise<string> | undefined;

export interface ActivitySummary {
  id: string;
  title: string;
  theme: string;
  district: string;
  businessArea: string;
  startsAt: string;
  serviceFeeCents: number;
  status: string;
}

export interface OrderDetail {
  id: string;
  amountCents: number;
  status: string;
  visibility: string;
  paymentState: "NONE" | "PROCESSING" | "REQUIRES_REVIEW";
  canRequestCancel: boolean;
  refunds: Array<{ id: string; status: string; amountCents: number; updatedAt: string; requiresReview: boolean }>;
  activity: {
    id: string;
    title: string;
    theme: string;
    district: string;
    businessArea: string;
    startsAt: string;
    endsAt: string;
    restaurantName: string | null;
    address: string | null;
  };
}

export interface SubmittedReport {
  id: string;
  type: string;
  status: "OPEN" | "RESOLVED" | "REJECTED";
  createdAt: string;
}

export interface SubmittedReview {
  id: string;
  score: number;
  tags: string[];
  content: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InboxNotification {
  id: string;
  type: string;
  status: string;
  payload: { title?: string; message?: string } | null;
  createdAt: string;
  readAt: string | null;
  orderId: string | null;
  activityId: string | null;
}

export interface UserProfile {
  id: string;
  preferredAreas: string[];
  availableTimes: string[];
  tastePreferences: string[];
  dietaryRestrictions: string[];
  budgetRange: string;
  tableVibe: string;
  acceptableTableSizes: number[];
  note: string | null;
}

export interface UserProfileInput {
  preferredAreas: string[];
  availableTimes: string[];
  tastePreferences: string[];
  dietaryRestrictions: string[];
  budgetRange: string;
  tableVibe: string;
  acceptableTableSizes: number[];
  note?: string;
}

export async function listActivities(): Promise<ActivitySummary[]> {
  const data = await apiRequest<{ activities: ActivitySummary[] }>("/api/activities");
  return data.activities;
}

export async function getActivity(activityId: string): Promise<ActivitySummary> {
  const data = await apiRequest<{ activity: ActivitySummary }>(`/api/activities/${activityId}`);
  return data.activity;
}

export async function ensureAuthenticatedUser(): Promise<string> {
  const cached = Taro.getStorageSync<string>(TOKEN_KEY);
  if (cached) return cached;
  if (!pendingLogin) {
    pendingLogin = (demoModeEnabled ? ensureMockUser() : loginWithWechatProvider())
      .finally(() => { pendingLogin = undefined; });
  }
  return pendingLogin;
}

export async function ensureMockUser(): Promise<string> {
  if (!demoModeEnabled) throw new Error("当前环境不支持演示登录");
  const cached = Taro.getStorageSync<string>(TOKEN_KEY);
  if (cached) {
    return cached;
  }
  const token = await loginWithWechatCode(`miniapp-${Date.now()}`);
  await apiRequest("/api/mock/phone", {
    method: "POST",
    token,
    data: { phone: "13800138000" },
  });
  return token;
}

export async function loginWithWechatCode(code: string): Promise<string> {
  const login = await apiRequest<{ token: string }>("/api/mock/wechat-login", {
    method: "POST",
    data: { code },
  });
  Taro.setStorageSync(TOKEN_KEY, login.token);
  return login.token;
}

export async function loginWithWechatProvider(): Promise<string> {
  const login = await Taro.login();
  if (!login.code) {
    throw new Error("微信登录未返回授权码");
  }
  return loginWithWechatCode(login.code);
}

export interface V11UserIdentity {
  id: string; userId: string; personId: string; role: "USER"; version: number;
}

// No second credential cache: all responses remain bound to the current WeChat session.
export async function initializeAvailableV11Identity(authToken: string): Promise<V11UserIdentity | null> {
  if (!isCurrentUserSession(authToken)) throw new Error("登录状态已改变，请重新加载");
  const capability = await apiRequest<{ version: string; identityEnabled: boolean }>("/api/v11/identity/capabilities", { token: authToken });
  if (capability.version !== "v11-identity-1" || typeof capability.identityEnabled !== "boolean") throw new Error("账号服务暂不可用，请稍后重试");
  if (!capability.identityEnabled) return null;
  const response = await apiRequest<{ version: string; principal: V11UserIdentity & { restaurantId: null } }>("/api/v11/identity/initialize", { method: "POST", token: authToken, data: {} });
  const actor = response.principal;
  if (response.version !== "v11-identity-1" || !actor || actor.role !== "USER" || actor.restaurantId !== null
      || typeof actor.id !== "string" || !actor.id || typeof actor.userId !== "string" || !actor.userId
      || typeof actor.personId !== "string" || !actor.personId || !Number.isInteger(actor.version) || actor.version < 0) {
    throw new Error("账号初始化失败，请重新登录后重试");
  }
  return { id: actor.id, userId: actor.userId, personId: actor.personId, role: "USER", version: actor.version };
}

export async function bindPhoneWithWechatCode(code: string): Promise<void> {
  const token = Taro.getStorageSync<string>(TOKEN_KEY);
  if (!token) {
    throw new Error("请先完成登录");
  }
  await apiRequest("/api/mock/phone", {
    method: "POST",
    token,
    data: { code },
  });
}

export function hasAuthenticatedSession(): boolean {
  return Boolean(Taro.getStorageSync<string>(TOKEN_KEY));
}

export function isCurrentUserSession(token: string): boolean {
  return Taro.getStorageSync<string>(TOKEN_KEY) === token;
}

export interface CurrentAgreement {
  version: string;
  text: string;
  textHash: string;
  activatedAt: string;
  source: string;
}

export async function getCurrentAgreement(): Promise<CurrentAgreement> {
  const data = await apiRequest<{ agreement: CurrentAgreement }>("/api/agreement/current");
  return data.agreement;
}

export async function confirmAgreement(agreementVersion: string): Promise<void> {
  const authToken = requireAuthenticatedSession();
  await apiRequest("/api/consents", {
    method: "POST",
    token: authToken,
    data: { agreementVersion, source: "miniapp-registration" },
  });
}

export async function createAndPayOrder(activityId: string, agreementVersion: string): Promise<string> {
  const authToken = requireAuthenticatedSession();
  const orderData = await apiRequest<{ order: { id: string } }>("/api/orders", {
    method: "POST",
    token: authToken,
    data: { activityId, agreementVersion },
  });
  // Preserve recovery context even if the user cancels payment or the channel fails.
  Taro.setStorageSync(LAST_ORDER_ID_KEY, orderData.order.id);
  await continueOrderPayment(orderData.order.id);
  return orderData.order.id;
}

export async function continueOrderPayment(orderId: string): Promise<string> {
  const authToken = requireAuthenticatedSession();
  const paymentData = await apiRequest<{
    payment: { id: string; channel?: string; status?: string };
    payable?: boolean;
    processing?: boolean;
    requiresReview?: boolean;
    paymentParams?: {
      timeStamp: string;
      nonceStr: string;
      package: string;
      signType: "RSA";
      paySign: string;
    };
  }>("/api/mock/payments", {
    method: "POST",
    token: authToken,
    data: { orderId },
  });
  if (paymentData.requiresReview) return "付款状态待核查，请稍后刷新订单或联系运营";
  if (paymentData.processing) return "付款结果处理中，请稍后刷新订单";
  if (paymentData.payment.status === "SUCCEEDED") return "付款结果已更新，请查看订单状态";
  if (paymentData.payable === false) return "当前订单暂时不可支付，请刷新查看状态";
  if (paymentData.paymentParams) {
    await Taro.requestPayment(paymentData.paymentParams);
  } else if (demoModeEnabled && paymentData.payment.channel === "mock" && paymentData.payable === true) {
    await apiRequest(`/api/mock/payments/${paymentData.payment.id}/succeed`, {
      method: "POST",
    });
  } else {
    throw new Error("暂时无法发起支付，请从订单页重试");
  }
  return "已提交付款，请以刷新后的订单状态为准";
}

function requireAuthenticatedSession(): string {
  const token = Taro.getStorageSync<string>(TOKEN_KEY);
  if (!token) {
    throw new Error("请先完成登录");
  }
  return token;
}

export interface OrderSummary {
  id: string; status: string; amountCents: number; createdAt: string;
  activity: { id: string; title: string; startsAt: string; endsAt: string };
}
export async function listOrders(cursor?: string): Promise<{ orders: OrderSummary[]; nextCursor: string | null }> {
  const token = await ensureAuthenticatedUser();
  return apiRequest(`/api/orders${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { token });
}
export async function getOrder(orderId: string): Promise<OrderDetail> {
  const token = await ensureAuthenticatedUser();
  const data = await apiRequest<{ order: OrderDetail }>(`/api/orders/${encodeURIComponent(orderId)}`, { token });
  return data.order;
}
export async function getLastOrder(): Promise<OrderDetail> {
  const orderId = Taro.getStorageSync<string>(LAST_ORDER_ID_KEY);
  if (orderId) return getOrder(orderId);
  const first = (await listOrders()).orders[0];
  if (!first) throw new Error("暂无订单，请先报名活动");
  return getOrder(first.id);
}
export async function getOrderPage(orderId?: string): Promise<{ order: OrderDetail; notifications: InboxNotification[]; notificationUnavailable: boolean }> {
  const token = await ensureAuthenticatedUser();
  const [order, notifications] = await Promise.allSettled([orderId ? getOrder(orderId) : getLastOrder(), getNotifications()]);
  if (!isCurrentUserSession(token)) throw new Error("登录状态已改变，请重新登录后刷新");
  if (order.status === "rejected") throw order.reason;
  return { order: order.value, notifications: notifications.status === "fulfilled" ? notifications.value : [],
    notificationUnavailable: notifications.status === "rejected" };
}
export async function requestOrderCancel(orderId: string, reason: string): Promise<void> {
  const authToken = requireAuthenticatedSession();
  await apiRequest(`/api/orders/${encodeURIComponent(orderId)}/cancel`, { method: "POST", token: authToken, data: { reason: reason.trim() } });
}

export async function submitOrderReport(orderId: string, type: string, content: string): Promise<SubmittedReport> {
  const token = await ensureAuthenticatedUser();
  const data = await apiRequest<{ report: SubmittedReport }>(`/api/orders/${orderId}/reports`, {
    method: "POST",
    token,
    data: { type, content },
  });
  return data.report;
}

export async function submitOrderReview(orderId: string, score: number, tags: string[], content: string): Promise<SubmittedReview> {
  const token = await ensureAuthenticatedUser();
  const data = await apiRequest<{ review: SubmittedReview }>(`/api/orders/${orderId}/review`, {
    method: "PUT",
    token,
    data: { score, tags, ...(content.trim() ? { content } : {}) },
  });
  return data.review;
}

export async function getNotifications(): Promise<InboxNotification[]> {
  return (await getNotificationPage()).notifications;
}

export async function getNotificationPage(cursor?: string): Promise<{ notifications: InboxNotification[]; nextCursor: string | null }> {
  const token = await ensureAuthenticatedUser();
  return apiRequest<{ notifications: InboxNotification[]; nextCursor: string | null }>(
    `/api/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { token });
}

export async function markNotificationRead(id: string): Promise<void> {
  const token = await ensureAuthenticatedUser();
  await apiRequest(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "POST", token });
}

export async function getProfile(): Promise<UserProfile | null> {
  const token = await ensureAuthenticatedUser();
  const data = await apiRequest<{ profile: UserProfile | null }>("/api/profile", { token });
  return data.profile;
}

export async function saveProfile(profile: UserProfileInput): Promise<UserProfile> {
  const token = await ensureAuthenticatedUser();
  const data = await apiRequest<{ profile: UserProfile }>("/api/profile", {
    method: "PUT",
    token,
    data: profile,
  });
  return data.profile;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT";
  token?: string;
  data?: unknown;
}

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await Taro.request<T & { error?: string }>({
    url: `${API_BASE_URL}${path}`,
    method: options.method ?? "GET",
    data: options.data === undefined && options.method && options.method !== "GET" ? {} : options.data,
    header: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      "content-type": "application/json",
    },
  });
  if (response.statusCode === 401) {
    if (options.token && Taro.getStorageSync(TOKEN_KEY) === options.token) {
      Taro.removeStorageSync(TOKEN_KEY);
    }
    // Keep pending order and form context; a failed request is never silently replayed.
    throw new Error("登录已失效，请重新登录后继续");
  }
  if (options.token && Taro.getStorageSync(TOKEN_KEY) !== options.token) {
    throw new Error("登录状态已改变，请重新加载");
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const data = response.data as { error?: string | {code?:string} };
    const messages:Record<string,string>={RESOURCE_NOT_FOUND:'未找到本人的记录',FUNDS_DATA_CONFLICT:'收款与退款记录正在核对，请稍后重试',FORBIDDEN:'当前账号无法执行此操作',INVALID_INPUT:'提交内容有误，请重新加载后重试',REQUEST_IDEMPOTENCY_CONFLICT:'申请信息正在核对，请稍后重试'};
    throw new Error(typeof data.error==='string'?data.error:messages[data.error?.code??'']??`请求未完成，请稍后重试（${response.statusCode}）`);
  }
  return response.data;
}

export interface FormalRefundRequest {
  requestId:string; registrationId:string; acceptedAt:string; state:string;
  scope:'REQUEST_INTAKE_ONLY'; refundApproved:false; policyActivation:'NOT_ASSESSED';
}
export interface FormalFunds {
  version:'v11-funds-1'; scope:'MONETARY_RECORDS_ONLY'; observation:'RECORDED_ONLY';
  registrationId:string; paidCents:number; confirmedRefundCents:number; unallocatedReceiptCount:number;
  receipts:Array<{receiptId:string;amountCents:number;paidAt:string;classification:string}>;
  refunds:Array<{refundId:string;amountCents:number;state:string}>;
}
export interface MoneyRegistration {registrationId:string;activityTitle:string;startsAt:string;refundRequests:FormalRefundRequest[]}
export async function openMoneySession(){
  const token=await ensureAuthenticatedUser();
  const capabilities=await apiRequest<{version:string;identityEnabled:boolean;financialRecordsEnabled:boolean;refundIntakeEnabled:boolean}>("/api/v11/identity/capabilities",{token});
  if(capabilities.version!=='v11-identity-1'||!capabilities.identityEnabled||(!capabilities.financialRecordsEnabled&&!capabilities.refundIntakeEnabled))throw Error('收款与退款记录服务暂不可用');
  const actor=await initializeAvailableV11Identity(token);if(!actor)throw Error('请重新登录后重试');
  return {token,userId:actor.userId,financialRecordsEnabled:capabilities.financialRecordsEnabled===true,refundIntakeEnabled:capabilities.refundIntakeEnabled===true};
}
export async function listMoneyRegistrations(token:string,cursor?:string){
 return apiRequest<{registrations:MoneyRegistration[];nextCursor:string|null}>(`/api/v11/money-registrations${cursor?'?cursor='+encodeURIComponent(cursor):''}`,{token});
}
export async function getFormalFunds(token:string,id:string){return apiRequest<FormalFunds>(`/api/v11/registrations/${encodeURIComponent(id)}/funds`,{token});}
export async function submitFormalRefund(token:string,id:string,idempotencyKey:string){
 return apiRequest<FormalRefundRequest>(`/api/v11/registrations/${encodeURIComponent(id)}/refund-requests`,{method:'POST',token,data:{idempotencyKey}});
}
export async function getFormalRefund(token:string,id:string){return apiRequest<FormalRefundRequest>(`/api/v11/refund-requests/${encodeURIComponent(id)}`,{token});}
