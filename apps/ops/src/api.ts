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
  endsAt: string;
  registrationEndsAt: string;
  minSize: number;
  serviceFeeCents: number;
}

export interface OpsTableCandidate {
  order: { id: string; status: string; createdAt: string };
  profile: {
    preferredAreas: string[];
    availableTimes: string[];
    tastePreferences: string[];
    dietaryRestrictions: string[];
    budgetRange: string;
    tableVibe: string;
    acceptableTableSizes: number[];
  } | null;
}

export interface OpsTableGroup {
  id: string;
  status: string;
  orderIds: string[];
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

export interface OpsReport {
  id: string;
  type: string;
  content: string;
  status: "OPEN" | "RESOLVED" | "REJECTED";
  createdAt: string;
  order: { id: string; status: string; activityTitle: string };
}

export interface OpsReview {
  id: string;
  score: number;
  tags: string[];
  content: string | null;
  createdAt: string;
  updatedAt: string;
  order: { id: string; activityTitle: string };
}

export interface OpsBlacklistEntry {
  id: string;
  userId: string;
  reason: string;
  createdAt: string;
  user: { phone: string | null; status: string };
}

export interface OpsData {
  restaurants: OpsRestaurant[];
  activities: OpsActivity[];
  orders: OpsOrder[];
  refunds: OpsRefund[];
  reports: OpsReport[];
  reviews: OpsReview[];
  blacklist: OpsBlacklistEntry[];
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
  const [restaurants, activities, orders, refunds, reports, reviews, blacklist, auditLogs] = await Promise.all([
    apiRequest<{ restaurants: OpsRestaurant[] }>("/api/ops/restaurants", authOptions(token)),
    apiRequest<{ activities: OpsActivity[] }>("/api/ops/activities", authOptions(token)),
    apiRequest<{ orders: OpsOrder[] }>("/api/ops/orders", authOptions(token)),
    apiRequest<{ refunds: OpsRefund[] }>("/api/ops/refunds", authOptions(token)),
    apiRequest<{ reports: OpsReport[] }>("/api/ops/reports", authOptions(token)),
    apiRequest<{ reviews: OpsReview[] }>("/api/ops/reviews", authOptions(token)),
    apiRequest<{ entries: OpsBlacklistEntry[] }>("/api/ops/blacklist", authOptions(token)),
    apiRequest<{ auditLogs: OpsAuditLog[] }>("/api/ops/audit-logs", authOptions(token)),
  ]);

  return {
    restaurants: restaurants.restaurants,
    activities: activities.activities,
    orders: orders.orders,
    refunds: refunds.refunds,
    reports: reports.reports,
    reviews: reviews.reviews,
    blacklist: blacklist.entries,
    auditLogs: auditLogs.auditLogs,
  };
}

export async function addBlacklistEntry(token: string, userId: string, reason: string): Promise<{ idempotent: boolean }> {
  return apiRequest("/api/ops/blacklist", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId, reason }),
  });
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

export async function resolveReport(token: string, reportId: string, status: "RESOLVED" | "REJECTED", reason: string): Promise<void> {
  await apiRequest(`/api/ops/reports/${reportId}/resolve`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ status, reason }),
  });
}

export async function loadTableCandidates(token: string, activityId: string): Promise<{ candidates: OpsTableCandidate[]; tableGroups: OpsTableGroup[] }> {
  return apiRequest<{ candidates: OpsTableCandidate[]; tableGroups: OpsTableGroup[] }>(
    `/api/ops/activities/${activityId}/table-candidates`,
    authOptions(token),
  );
}

export async function draftTableGroups(
  token: string,
  activityId: string,
): Promise<{ idempotent: boolean; tableGroups: OpsTableGroup[] }> {
  return apiRequest(`/api/ops/activities/${activityId}/table-groups/draft`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

export async function confirmTableGroups(
  token: string,
  activityId: string,
): Promise<{ idempotent: boolean; activityStatus: string }> {
  return apiRequest(`/api/ops/activities/${activityId}/table-groups/confirm`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

export async function adjustTableGroups(
  token: string,
  activityId: string,
  tableGroups: Array<{ orderIds: string[] }>,
): Promise<{ tableGroups: OpsTableGroup[] }> {
  return apiRequest(`/api/ops/activities/${activityId}/table-groups`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ tableGroups }),
  });
}

export async function markGroupFailed(token: string, activityId: string, reason: string): Promise<{ idempotent: boolean; activityStatus: string; affectedOrderCount?: number }> {
  return apiRequest(`/api/ops/activities/${activityId}/mark-group-failed`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason }),
  });
}

export async function startActivity(token: string, activityId: string): Promise<{ idempotent: boolean; activityStatus: string }> {
  return apiRequest(`/api/ops/activities/${activityId}/start`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

export async function completeActivity(token: string, activityId: string): Promise<{ idempotent: boolean; activityStatus: string; completedOrderCount: number }> {
  return apiRequest(`/api/ops/activities/${activityId}/complete`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
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
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? `API 请求失败：${response.status}`);
  }
  return data as T;
}
