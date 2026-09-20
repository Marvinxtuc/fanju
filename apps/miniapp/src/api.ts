import Taro from "@tarojs/taro";

declare const __FANJU_API_BASE_URL__: string;

const API_BASE_URL = __FANJU_API_BASE_URL__;
const TOKEN_KEY = "timeleft_mock_token";
const LAST_ORDER_ID_KEY = "timeleft_last_order_id";

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

export async function ensureMockUser(): Promise<string> {
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

export async function confirmAgreement(agreementVersion: string): Promise<void> {
  const authToken = requireAuthenticatedSession();
  await apiRequest("/api/consents", {
    method: "POST",
    token: authToken,
    data: { agreementVersion, source: "miniapp-registration" },
  });
}

export async function createAndPayOrder(activityId: string): Promise<string> {
  const authToken = requireAuthenticatedSession();
  const orderData = await apiRequest<{ order: { id: string } }>("/api/orders", {
    method: "POST",
    token: authToken,
    data: { activityId, agreementVersion: "v1" },
  });
  const paymentData = await apiRequest<{
    payment: { id: string };
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
    data: { orderId: orderData.order.id },
  });
  if (paymentData.paymentParams) {
    await Taro.requestPayment(paymentData.paymentParams);
  } else {
    await apiRequest(`/api/mock/payments/${paymentData.payment.id}/succeed`, {
      method: "POST",
    });
  }
  Taro.setStorageSync(LAST_ORDER_ID_KEY, orderData.order.id);
  return orderData.order.id;
}

function requireAuthenticatedSession(): string {
  const token = Taro.getStorageSync<string>(TOKEN_KEY);
  if (!token) {
    throw new Error("请先完成登录");
  }
  return token;
}

export async function getLastOrder(): Promise<OrderDetail> {
  const token = await ensureMockUser();
  const orderId = Taro.getStorageSync<string>(LAST_ORDER_ID_KEY);
  if (!orderId) {
    throw new Error("暂无订单，请先报名活动");
  }
  const data = await apiRequest<{ order: OrderDetail }>(`/api/orders/${orderId}`, {
    token,
  });
  return data.order;
}

export async function submitOrderReport(orderId: string, type: string, content: string): Promise<SubmittedReport> {
  const token = await ensureMockUser();
  const data = await apiRequest<{ report: SubmittedReport }>(`/api/orders/${orderId}/reports`, {
    method: "POST",
    token,
    data: { type, content },
  });
  return data.report;
}

export async function submitOrderReview(orderId: string, score: number, tags: string[], content: string): Promise<SubmittedReview> {
  const token = await ensureMockUser();
  const data = await apiRequest<{ review: SubmittedReview }>(`/api/orders/${orderId}/review`, {
    method: "PUT",
    token,
    data: { score, tags, ...(content.trim() ? { content } : {}) },
  });
  return data.review;
}

export async function getNotifications(): Promise<InboxNotification[]> {
  const token = await ensureMockUser();
  const data = await apiRequest<{ notifications: InboxNotification[] }>("/api/notifications", { token });
  return data.notifications;
}

export async function getProfile(): Promise<UserProfile | null> {
  const token = await ensureMockUser();
  const data = await apiRequest<{ profile: UserProfile | null }>("/api/profile", { token });
  return data.profile;
}

export async function saveProfile(profile: UserProfileInput): Promise<UserProfile> {
  const token = await ensureMockUser();
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
    data: options.data,
    header: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      "content-type": "application/json",
    },
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const data = response.data as { error?: string };
    throw new Error(data.error ?? `API 请求失败：${response.statusCode}`);
  }
  return response.data;
}
