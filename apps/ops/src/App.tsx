import { useEffect, useState } from "react";

import {
  approveRefund,
  loadOpsData,
  loginOps,
  type OpsData,
} from "./api.js";

type OpsTab = "restaurants" | "activities" | "orders" | "audit";

const tabs: Array<{ id: OpsTab; label: string }> = [
  { id: "restaurants", label: "餐厅" },
  { id: "activities", label: "活动" },
  { id: "orders", label: "订单/退款" },
  { id: "audit", label: "审计" },
];

export function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState<OpsTab>("restaurants");
  const [token, setToken] = useState("");
  const [data, setData] = useState<OpsData | null>(null);
  const [error, setError] = useState("");

  async function refresh(): Promise<void> {
    try {
      setError("");
      const nextToken = token || (await loginOps());
      setToken(nextToken);
      setData(await loadOpsData(nextToken));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "后台数据加载失败");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleApproveRefund(refundId: string): Promise<void> {
    try {
      setError("");
      await approveRefund(token, refundId);
      await refresh();
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "退款审批失败");
    }
  }

  return (
    <main className="ops-shell">
      <header className="ops-header">
        <div>
          <p className="eyebrow">运营后台 MVP</p>
          <h1>餐厅兴趣体验管理台</h1>
        </div>
        <button type="button" onClick={() => void refresh()}>
          刷新
        </button>
      </header>

      <nav className="ops-tabs" aria-label="后台模块">
        {tabs.map((tab) => (
          <button
            aria-current={activeTab === tab.id ? "page" : undefined}
            className={activeTab === tab.id ? "ops-tabs__item ops-tabs__item--active" : "ops-tabs__item"}
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {error ? <p role="alert">错误：{error}</p> : null}
      {!data ? <p>加载中</p> : renderTab(activeTab, data, handleApproveRefund)}
    </main>
  );
}

function renderTab(
  activeTab: OpsTab,
  data: OpsData,
  onApproveRefund: (refundId: string) => Promise<void>,
): JSX.Element {
  if (activeTab === "restaurants") {
    return (
      <section className="ops-content">
        <h2>餐厅</h2>
        {data.restaurants.map((restaurant) => (
          <p key={restaurant.id}>
            {restaurant.name} / {restaurant.district}-{restaurant.businessArea} / 容量 {restaurant.capacity}
          </p>
        ))}
      </section>
    );
  }

  if (activeTab === "activities") {
    return (
      <section className="ops-content">
        <h2>活动</h2>
        {data.activities.map((activity) => (
          <p key={activity.id}>
            {activity.title} / {activity.status} / 服务费 {activity.serviceFeeCents / 100} 元
          </p>
        ))}
      </section>
    );
  }

  if (activeTab === "orders") {
    return (
      <section className="ops-content">
        <h2>订单/退款</h2>
        {data.orders.map((order) => (
          <p key={order.id}>
            {order.id} / {order.activity.title} / {order.status} / {order.amountCents / 100} 元
          </p>
        ))}
        <h3>退款</h3>
        {data.refunds.map((refund) => (
          <p key={refund.id}>
            {refund.id} / {refund.order.activityTitle} / {refund.status}
            {refund.status === "REVIEWING" || refund.status === "FAILED" ? (
              <button type="button" onClick={() => void onApproveRefund(refund.id)}>
                审批通过
              </button>
            ) : null}
          </p>
        ))}
      </section>
    );
  }

  return (
    <section className="ops-content">
      <h2>审计</h2>
      {data.auditLogs.map((item) => (
        <p key={item.id}>
          {item.action} / {item.targetType} / {item.reason ?? "无原因"}
        </p>
      ))}
    </section>
  );
}
