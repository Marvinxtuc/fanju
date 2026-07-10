import { useEffect, useState } from "react";

import {
  approveRefund,
  loadOpsData,
  loginOps,
  type OpsActivity,
  type OpsData,
  type OpsOrder,
  type OpsRefund,
  type OpsRestaurant,
} from "./api.js";

import "./app.css";

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
        <div className="ops-header__copy">
          <p className="eyebrow">CITY MENU LAB OPS</p>
          <h1>饭局运营台</h1>
          <p>用菜单、饭票和审计小票管理上海本地餐厅兴趣体验。</p>
        </div>
        <div className="ops-logo" aria-hidden="true">
          局
        </div>
        <button className="ops-button ops-button--secondary" type="button" onClick={() => void refresh()}>
          刷新
        </button>
      </header>

      {data ? <Dashboard data={data} /> : null}

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

      {error ? (
        <p className="ops-alert" role="alert">
          错误：{error}
        </p>
      ) : null}
      {!data ? <p className="ops-loading">加载中</p> : renderTab(activeTab, data, handleApproveRefund)}
    </main>
  );
}

function Dashboard({ data }: { data: OpsData }): JSX.Element {
  const reviewingRefunds = data.refunds.filter((refund) => refund.status === "REVIEWING" || refund.status === "FAILED").length;
  const paidOrders = data.orders.filter((order) => order.status !== "CANCELED" && order.status !== "REFUNDED").length;

  return (
    <section className="ops-dashboard" aria-label="运营概览">
      <MetricCard label="餐厅库" value={String(data.restaurants.length)} note="可排期资源" />
      <MetricCard label="饭局排期" value={String(data.activities.length)} note="活动状态跟踪" />
      <MetricCard label="有效订单" value={String(paidOrders)} note="服务费口径" tone="blue" />
      <MetricCard label="待审退款" value={String(reviewingRefunds)} note="需人工确认" tone="red" />
    </section>
  );
}

function MetricCard({ label, value, note, tone = "orange" }: { label: string; value: string; note: string; tone?: "orange" | "blue" | "red" }): JSX.Element {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
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
        <SectionHeader title="餐厅菜单库" subtitle="维护可开桌餐厅、区域和容量，页面仅展示运营必要信息。" stamp="MENU" />
        <div className="ticket-grid">
          {data.restaurants.map((restaurant) => (
            <RestaurantTicket key={restaurant.id} restaurant={restaurant} />
          ))}
        </div>
      </section>
    );
  }

  if (activeTab === "activities") {
    return (
      <section className="ops-content">
        <SectionHeader title="饭局排期" subtitle="跟踪活动状态、服务费和开桌时间，保持饭局优先的表达。" stamp="OPEN" />
        <div className="ticket-list">
          {data.activities.map((activity) => (
            <ActivityTicket activity={activity} key={activity.id} />
          ))}
        </div>
      </section>
    );
  }

  if (activeTab === "orders") {
    return (
      <section className="ops-content">
        <SectionHeader title="订单与退款小票" subtitle="保留服务端计价和退款状态机入口，待审项以小票方式突出。" stamp="RECEIPT" />
        <div className="ticket-list">
          {data.orders.map((order) => (
            <OrderTicket key={order.id} order={order} />
          ))}
        </div>
        <h3 className="subheading">退款审核</h3>
        <div className="ticket-list">
          {data.refunds.map((refund) => (
            <RefundTicket key={refund.id} onApproveRefund={onApproveRefund} refund={refund} />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="ops-content">
      <SectionHeader title="审计小票" subtitle="高风险操作以时间线记录，方便外部总控复核。" stamp="AUDIT" />
      <ol className="audit-timeline">
        {data.auditLogs.map((item) => (
          <li className="audit-ticket" key={item.id}>
            <span className="ticket-label">{formatDateTime(item.createdAt)}</span>
            <strong>{item.action}</strong>
            <span>
              {item.targetType} / {item.reason ?? "无原因"}
            </span>
            <small>{item.targetId}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SectionHeader({ title, subtitle, stamp }: { title: string; subtitle: string; stamp: string }): JSX.Element {
  return (
    <header className="section-header">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <span className="stamp">{stamp}</span>
    </header>
  );
}

function RestaurantTicket({ restaurant }: { restaurant: OpsRestaurant }): JSX.Element {
  return (
    <article className="ops-ticket">
      <div className="ticket-top">
        <span className="ticket-label">RESTAURANT</span>
        <span className="tag tag--green">可排期</span>
      </div>
      <h3>{restaurant.name}</h3>
      <p>
        {restaurant.district} · {restaurant.businessArea}
      </p>
      <div className="ticket-divider" />
      <div className="ticket-facts">
        <span>容量</span>
        <strong>{restaurant.capacity} 人</strong>
      </div>
    </article>
  );
}

function ActivityTicket({ activity }: { activity: OpsActivity }): JSX.Element {
  return (
    <article className="ops-ticket ops-ticket--wide">
      <div className="ticket-top">
        <span className="ticket-label">{formatDateTime(activity.startsAt)}</span>
        <span className="tag tag--orange">{activity.status}</span>
      </div>
      <h3>{activity.title}</h3>
      <p>菜单体验 / 公共餐厅 / 服务费 {formatMoney(activity.serviceFeeCents)}</p>
      <div className="ticket-divider" />
      <div className="ticket-facts">
        <span>服务费/订位费</span>
        <strong>{formatMoney(activity.serviceFeeCents)}</strong>
      </div>
    </article>
  );
}

function OrderTicket({ order }: { order: OpsOrder }): JSX.Element {
  return (
    <article className="ops-ticket ops-ticket--wide">
      <div className="ticket-top">
        <span className="ticket-label">{order.id}</span>
        <span className="tag">{order.status}</span>
      </div>
      <h3>{order.activity.title}</h3>
      <p>用户手机号：{order.user.phone ?? "未展示"}</p>
      <div className="ticket-divider" />
      <div className="ticket-facts">
        <span>订单金额</span>
        <strong>{formatMoney(order.amountCents)}</strong>
      </div>
    </article>
  );
}

function RefundTicket({
  refund,
  onApproveRefund,
}: {
  refund: OpsRefund;
  onApproveRefund: (refundId: string) => Promise<void>;
}): JSX.Element {
  const canApprove = refund.status === "REVIEWING" || refund.status === "FAILED";

  return (
    <article className={canApprove ? "ops-ticket ops-ticket--review" : "ops-ticket"}>
      <div className="ticket-top">
        <span className="ticket-label">{refund.id}</span>
        <span className={canApprove ? "tag tag--red" : "tag"}>{refund.status}</span>
      </div>
      <h3>{refund.order.activityTitle}</h3>
      <p>{refund.reason}</p>
      <div className="ticket-divider" />
      <div className="ticket-facts">
        <span>{formatMoney(refund.amountCents)}</span>
        {canApprove ? (
          <button className="ops-button ops-button--primary" type="button" onClick={() => void onApproveRefund(refund.id)}>
            审批通过
          </button>
        ) : (
          <strong>{refund.order.status}</strong>
        )}
      </div>
    </article>
  );
}

function formatMoney(cents: number): string {
  return `¥${(cents / 100).toFixed(0)}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
