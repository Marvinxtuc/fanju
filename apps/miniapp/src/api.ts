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
    restaurantName: string | null;
    address: string | null;
  };
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

export async function createAndPayOrder(activityId: string): Promise<string> {
  const token = await ensureMockUser();
  const orderData = await apiRequest<{ order: { id: string } }>("/api/orders", {
    method: "POST",
    token,
    data: { activityId, agreementVersion: "v1" },
  });
  const paymentData = await apiRequest<{ payment: { id: string } }>("/api/mock/payments", {
    method: "POST",
    token,
    data: { orderId: orderData.order.id },
  });
  await apiRequest(`/api/mock/payments/${paymentData.payment.id}/succeed`, {
    method: "POST",
  });
  Taro.setStorageSync(LAST_ORDER_ID_KEY, orderData.order.id);
  return orderData.order.id;
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

interface RequestOptions {
  method?: "GET" | "POST";
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
