const API_BASE_URL = "http://localhost:3000";

export interface OpsRestaurant {
  id: string;
  name: string;
  district: string;
  businessArea: string;
  capacity: number;
}

export interface OpsActivity {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  serviceFeeCents: number;
}

export interface OpsOrder {
  id: string;
  amountCents: number;
  status: string;
  activity: { title: string };
  user: { phone: string | null };
}

export interface OpsRefund {
  id: string;
  amountCents: number;
  status: string;
  reason: string;
  order: { id: string; status: string; activityTitle: string; userPhone: string | null };
}

export interface OpsAuditLog {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  createdAt: string;
}

export interface OpsData {
  restaurants: OpsRestaurant[];
  activities: OpsActivity[];
  orders: OpsOrder[];
  refunds: OpsRefund[];
  auditLogs: OpsAuditLog[];
}

export async function loginOps(): Promise<string> {
  const response = await apiRequest<{ token: string }>("/api/mock/admin-login", {
    method: "POST",
    body: JSON.stringify({ username: "ops-demo", role: "OPS" }),
  });
  return response.token;
}

export async function loadOpsData(token: string): Promise<OpsData> {
  const [restaurants, activities, orders, refunds, auditLogs] = await Promise.all([
    apiRequest<{ restaurants: OpsRestaurant[] }>("/api/ops/restaurants", authOptions(token)),
    apiRequest<{ activities: OpsActivity[] }>("/api/ops/activities", authOptions(token)),
    apiRequest<{ orders: OpsOrder[] }>("/api/ops/orders", authOptions(token)),
    apiRequest<{ refunds: OpsRefund[] }>("/api/ops/refunds", authOptions(token)),
    apiRequest<{ auditLogs: OpsAuditLog[] }>("/api/ops/audit-logs", authOptions(token)),
  ]);

  return {
    restaurants: restaurants.restaurants,
    activities: activities.activities,
    orders: orders.orders,
    refunds: refunds.refunds,
    auditLogs: auditLogs.auditLogs,
  };
}

export async function approveRefund(token: string, refundId: string): Promise<void> {
  await apiRequest(`/api/ops/refunds/${refundId}/approve`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ reason: "运营快速审核通过" }),
  });
}

function authOptions(token: string): RequestInit {
  return { headers: { authorization: `Bearer ${token}` } };
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      "content-type": "application/json",
    },
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? `API 请求失败：${response.status}`);
  }
  return data as T;
}
