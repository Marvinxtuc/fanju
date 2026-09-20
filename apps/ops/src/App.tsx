import { useEffect, useState } from "react";

import {
  addBlacklistEntry,
  adjustTableGroups,
  approveRefund,
  completeActivity,
  confirmTableGroups,
  draftTableGroups,
  loadTableCandidates,
  loadOpsData,
  loginOps,
  markGroupFailed,
  resolveReport,
  startActivity,
  type OpsActivity,
  type OpsBlacklistEntry,
  type OpsData,
  type OpsOrder,
  type OpsRefund,
  type OpsReport,
  type OpsReview,
  type OpsRestaurant,
  type OpsTableCandidate,
  type OpsTableGroup,
} from "./api.js";
import { formatCandidateProfile } from "./candidate-profile.js";

import "./app.css";

type OpsTab = "restaurants" | "activities" | "orders" | "reports" | "reviews" | "blacklist" | "audit";

const tabs: Array<{ id: OpsTab; label: string }> = [
  { id: "restaurants", label: "餐厅" },
  { id: "activities", label: "活动" },
  { id: "orders", label: "订单/退款" },
  { id: "reports", label: "反馈处理" },
  { id: "reviews", label: "体验评价" },
  { id: "blacklist", label: "黑名单" },
  { id: "audit", label: "审计" },
];

export function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState<OpsTab>("restaurants");
  const [token, setToken] = useState("");
  const [data, setData] = useState<OpsData | null>(null);
  const [error, setError] = useState("");
  const [groupingActivityId, setGroupingActivityId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<OpsTableCandidate[] | null>(null);
  const [tableGroups, setTableGroups] = useState<OpsTableGroup[]>([]);
  const [groupingBusy, setGroupingBusy] = useState(false);
  const [activityLifecycleBusy, setActivityLifecycleBusy] = useState<string | null>(null);

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

  async function handleResolveReport(reportId: string, status: "RESOLVED" | "REJECTED", reason: string): Promise<void> {
    try {
      setError("");
      await resolveReport(token, reportId, status, reason);
      await refresh();
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : "反馈处理失败");
    }
  }

  async function handleAddBlacklistEntry(userId: string, reason: string): Promise<void> {
    try {
      setError("");
      await addBlacklistEntry(token, userId, reason);
      await refresh();
    } catch (blacklistError) {
      setError(blacklistError instanceof Error ? blacklistError.message : "黑名单添加失败");
    }
  }

  async function handleOpenGrouping(activityId: string): Promise<void> {
    try {
      setError("");
      setGroupingBusy(true);
      setGroupingActivityId(activityId);
      const grouping = await loadTableCandidates(token, activityId);
      setCandidates(grouping.candidates);
      setTableGroups(grouping.tableGroups);
    } catch (groupingError) {
      setError(groupingError instanceof Error ? groupingError.message : "候选人加载失败");
    } finally {
      setGroupingBusy(false);
    }
  }

  async function handleDraftGrouping(activityId: string): Promise<void> {
    try {
      setError("");
      setGroupingBusy(true);
      const draft = await draftTableGroups(token, activityId);
      setTableGroups(draft.tableGroups);
      await refresh();
    } catch (groupingError) {
      setError(groupingError instanceof Error ? groupingError.message : "排桌草案生成失败");
    } finally {
      setGroupingBusy(false);
    }
  }

  async function handleConfirmGrouping(activityId: string): Promise<void> {
    try {
      setError("");
      setGroupingBusy(true);
      await confirmTableGroups(token, activityId);
      await refresh();
    } catch (groupingError) {
      setError(groupingError instanceof Error ? groupingError.message : "成团确认失败");
    } finally {
      setGroupingBusy(false);
    }
  }

  async function handleAdjustGrouping(activityId: string, tableGroups: Array<{ orderIds: string[] }>): Promise<void> {
    try {
      setError("");
      setGroupingBusy(true);
      const adjusted = await adjustTableGroups(token, activityId, tableGroups);
      setTableGroups(adjusted.tableGroups);
    } catch (groupingError) {
      setError(groupingError instanceof Error ? groupingError.message : "人工调整保存失败");
    } finally {
      setGroupingBusy(false);
    }
  }

  async function handleMarkGroupFailed(activityId: string, reason: string): Promise<void> {
    try {
      setError("");
      setGroupingBusy(true);
      await markGroupFailed(token, activityId, reason);
      setTableGroups([]);
      await refresh();
    } catch (groupingError) {
      setError(groupingError instanceof Error ? groupingError.message : "成团失败标记失败");
    } finally {
      setGroupingBusy(false);
    }
  }

  async function handleStartActivity(activityId: string): Promise<void> {
    try {
      setError("");
      setActivityLifecycleBusy(activityId);
      await startActivity(token, activityId);
      await refresh();
    } catch (activityError) {
      setError(activityError instanceof Error ? activityError.message : "活动开始标记失败");
    } finally {
      setActivityLifecycleBusy(null);
    }
  }

  async function handleCompleteActivity(activityId: string): Promise<void> {
    try {
      setError("");
      setActivityLifecycleBusy(activityId);
      await completeActivity(token, activityId);
      await refresh();
    } catch (activityError) {
      setError(activityError instanceof Error ? activityError.message : "活动完成标记失败");
    } finally {
      setActivityLifecycleBusy(null);
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
      {!data ? <p className="ops-loading">加载中</p> : renderTab(activeTab, data, {
        onApproveRefund: handleApproveRefund,
        onOpenGrouping: handleOpenGrouping,
        onDraftGrouping: handleDraftGrouping,
        onConfirmGrouping: handleConfirmGrouping,
        onAdjustGrouping: handleAdjustGrouping,
        onMarkGroupFailed: handleMarkGroupFailed,
        onResolveReport: handleResolveReport,
        onAddBlacklistEntry: handleAddBlacklistEntry,
        onStartActivity: handleStartActivity,
        onCompleteActivity: handleCompleteActivity,
        groupingActivityId,
        candidates,
        tableGroups,
        groupingBusy,
        activityLifecycleBusy,
      })}
    </main>
  );
}

function Dashboard({ data }: { data: OpsData }): JSX.Element {
  const reviewingRefunds = data.refunds.filter((refund) => refund.status === "REVIEWING" || refund.status === "FAILED").length;
  const openReports = data.reports.filter((report) => report.status === "OPEN").length;
  const paidOrders = data.orders.filter((order) => order.status !== "CANCELED" && order.status !== "REFUNDED").length;

  return (
    <section className="ops-dashboard" aria-label="运营概览">
      <MetricCard label="餐厅库" value={String(data.restaurants.length)} note="可排期资源" />
      <MetricCard label="饭局排期" value={String(data.activities.length)} note="活动状态跟踪" />
      <MetricCard label="有效订单" value={String(paidOrders)} note="服务费口径" tone="blue" />
      <MetricCard label="待审退款" value={String(reviewingRefunds)} note="需人工确认" tone="red" />
      <MetricCard label="待处理反馈" value={String(openReports)} note="仅运营可见" tone="blue" />
      <MetricCard label="体验评价" value={String(data.reviews.length)} note="仅运营查看" tone="blue" />
      <MetricCard label="黑名单" value={String(data.blacklist.length)} note="限制新报名" tone="red" />
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
  actions: {
    onApproveRefund: (refundId: string) => Promise<void>;
    onOpenGrouping: (activityId: string) => Promise<void>;
    onDraftGrouping: (activityId: string) => Promise<void>;
    onConfirmGrouping: (activityId: string) => Promise<void>;
    onAdjustGrouping: (activityId: string, tableGroups: Array<{ orderIds: string[] }>) => Promise<void>;
    onMarkGroupFailed: (activityId: string, reason: string) => Promise<void>;
    onResolveReport: (reportId: string, status: "RESOLVED" | "REJECTED", reason: string) => Promise<void>;
    onAddBlacklistEntry: (userId: string, reason: string) => Promise<void>;
    onStartActivity: (activityId: string) => Promise<void>;
    onCompleteActivity: (activityId: string) => Promise<void>;
    groupingActivityId: string | null;
    candidates: OpsTableCandidate[] | null;
    tableGroups: OpsTableGroup[];
    groupingBusy: boolean;
    activityLifecycleBusy: string | null;
  },
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
            <ActivityTicket activity={activity} key={activity.id} onOpenGrouping={actions.onOpenGrouping} onStartActivity={actions.onStartActivity} onCompleteActivity={actions.onCompleteActivity} lifecycleBusy={actions.activityLifecycleBusy === activity.id} />
          ))}
        </div>
        {actions.groupingActivityId ? (
          <GroupingPanel
            activity={data.activities.find((activity) => activity.id === actions.groupingActivityId) ?? null}
            busy={actions.groupingBusy}
            candidates={actions.candidates}
            tableGroups={actions.tableGroups}
            onDraft={actions.onDraftGrouping}
            onConfirm={actions.onConfirmGrouping}
            onAdjust={actions.onAdjustGrouping}
            onMarkGroupFailed={actions.onMarkGroupFailed}
          />
        ) : null}
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
            <RefundTicket key={refund.id} onApproveRefund={actions.onApproveRefund} refund={refund} />
          ))}
        </div>
      </section>
    );
  }

  if (activeTab === "reports") {
    return (
      <section className="ops-content">
        <SectionHeader title="活动反馈处理" subtitle="仅运营查看原文；处理结果会写入审计小票。" stamp="CARE" />
        <div className="ticket-list">
          {data.reports.map((report) => <ReportTicket key={report.id} report={report} onResolveReport={actions.onResolveReport} />)}
        </div>
      </section>
    );
  }

  if (activeTab === "blacklist") {
    return (
      <section className="ops-content">
        <SectionHeader title="黑名单管理" subtitle="限制后续报名；既有订单保持不变，解除仅限超级管理员通过受控接口处理。" stamp="GUARD" />
        <BlacklistPanel entries={data.blacklist} onAddBlacklistEntry={actions.onAddBlacklistEntry} />
      </section>
    );
  }

  if (activeTab === "reviews") {
    return (
      <section className="ops-content">
        <SectionHeader title="体验评价" subtitle="仅用于运营复盘，不对外公开展示，也不会自动触发处罚。" stamp="REVIEW" />
        <div className="ticket-list">
          {data.reviews.length === 0 ? <p className="ops-loading">当前没有体验评价。</p> : data.reviews.map((review) => <ReviewTicket key={review.id} review={review} />)}
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

function ReviewTicket({ review }: { review: OpsReview }): JSX.Element {
  return (
    <article className="ops-ticket">
      <div className="ticket-top">
        <span className="ticket-label">{formatDateTime(review.updatedAt)}</span>
        <span className="tag tag--orange">{review.score} / 5</span>
      </div>
      <h3>{review.order.activityTitle}</h3>
      <p>订单 {review.order.id}</p>
      {review.tags.length > 0 ? <p>{review.tags.join(" · ")}</p> : null}
      {review.content ? <div className="report-content">{review.content}</div> : <p className="muted">未填写文字建议</p>}
    </article>
  );
}

function BlacklistPanel({
  entries,
  onAddBlacklistEntry,
}: {
  entries: OpsBlacklistEntry[];
  onAddBlacklistEntry: (userId: string, reason: string) => Promise<void>;
}): JSX.Element {
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    try {
      setBusy(true);
      await onAddBlacklistEntry(userId.trim(), reason.trim());
      setUserId("");
      setReason("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="blacklist-panel">
      <div className="blacklist-form">
        <p>仅输入已核验的内部用户 ID；列表仅展示脱敏手机号。</p>
        <div className="report-actions">
          <input aria-label="内部用户 ID" className="report-reason" value={userId} maxLength={80} onChange={(event) => setUserId(event.target.value)} placeholder="内部用户 ID" />
          <input aria-label="拉黑原因" className="report-reason" value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="填写运营处理原因" />
          <button className="ops-button ops-button--primary" disabled={busy || !userId.trim() || !reason.trim()} type="button" onClick={() => void submit()}>
            {busy ? "处理中…" : "添加黑名单"}
          </button>
        </div>
      </div>
      <div className="ticket-list">
        {entries.length === 0 ? <p className="ops-loading">当前没有黑名单记录。</p> : entries.map((entry) => (
          <article className="ops-ticket ops-ticket--review" key={entry.id}>
            <div className="ticket-top">
              <span className="ticket-label">{formatDateTime(entry.createdAt)}</span>
              <span className="tag tag--red">{entry.user.status}</span>
            </div>
            <h3>{entry.user.phone ?? "未绑定手机号"}</h3>
            <p>{entry.reason}</p>
            <div className="ticket-divider" />
            <small>内部用户 ID：{entry.userId}</small>
          </article>
        ))}
      </div>
    </div>
  );
}

function ReportTicket({ report, onResolveReport }: { report: OpsReport; onResolveReport: (reportId: string, status: "RESOLVED" | "REJECTED", reason: string) => Promise<void> }): JSX.Element {
  const [reason, setReason] = useState("");
  const isOpen = report.status === "OPEN";

  return (
    <article className={isOpen ? "ops-ticket ops-ticket--review" : "ops-ticket"}>
      <div className="ticket-top">
        <span className="ticket-label">{formatDateTime(report.createdAt)}</span>
        <span className={isOpen ? "tag tag--red" : "tag"}>{report.status}</span>
      </div>
      <h3>{report.type}</h3>
      <p>{report.order.activityTitle} · 订单 {report.order.id}</p>
      <div className="report-content">{report.content}</div>
      {isOpen ? (
        <div className="report-actions">
          <input aria-label="处理说明" className="report-reason" value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="填写处理说明" />
          <button className="ops-button ops-button--primary" disabled={!reason.trim()} type="button" onClick={() => void onResolveReport(report.id, "RESOLVED", reason)}>标记已处理</button>
          <button className="ops-button ops-button--secondary" disabled={!reason.trim()} type="button" onClick={() => void onResolveReport(report.id, "REJECTED", reason)}>不予受理</button>
        </div>
      ) : null}
    </article>
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

function ActivityTicket({
  activity,
  onOpenGrouping,
  onStartActivity,
  onCompleteActivity,
  lifecycleBusy,
}: {
  activity: OpsActivity;
  onOpenGrouping: (activityId: string) => Promise<void>;
  onStartActivity: (activityId: string) => Promise<void>;
  onCompleteActivity: (activityId: string) => Promise<void>;
  lifecycleBusy: boolean;
}): JSX.Element {
  const now = Date.now();
  const canStart = (activity.status === "GROUPED" || activity.status === "ADDRESS_UNLOCKED") && now >= new Date(activity.startsAt).getTime();
  const canComplete = activity.status === "IN_PROGRESS" && now >= new Date(activity.endsAt).getTime();
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
        <button className="ops-button ops-button--secondary" type="button" onClick={() => void onOpenGrouping(activity.id)}>
          排桌候选
        </button>
        {canStart ? <button className="ops-button ops-button--primary" disabled={lifecycleBusy} type="button" onClick={() => void onStartActivity(activity.id)}>{lifecycleBusy ? "处理中…" : "标记已开始"}</button> : null}
        {canComplete ? <button className="ops-button ops-button--primary" disabled={lifecycleBusy} type="button" onClick={() => void onCompleteActivity(activity.id)}>{lifecycleBusy ? "处理中…" : "标记已完成"}</button> : null}
      </div>
    </article>
  );
}

function GroupingPanel({
  activity,
  candidates,
  tableGroups,
  busy,
  onDraft,
  onConfirm,
  onAdjust,
  onMarkGroupFailed,
}: {
  activity: OpsActivity | null;
  candidates: OpsTableCandidate[] | null;
  tableGroups: OpsTableGroup[];
  busy: boolean;
  onDraft: (activityId: string) => Promise<void>;
  onConfirm: (activityId: string) => Promise<void>;
  onAdjust: (activityId: string, tableGroups: Array<{ orderIds: string[] }>) => Promise<void>;
  onMarkGroupFailed: (activityId: string, reason: string) => Promise<void>;
}): JSX.Element {
  const [failureReason, setFailureReason] = useState("");
  const [adjustmentText, setAdjustmentText] = useState("");
  useEffect(() => {
    setAdjustmentText(tableGroups.map((group) => group.orderIds.join(", ")).join("\n"));
  }, [tableGroups]);
  if (!activity) {
    return <p className="ops-alert">活动状态已刷新，请重新选择排桌候选。</p>;
  }
  const canDraft = activity.status === "REGISTRATION_OPEN";
  const canConfirm = activity.status === "LOCKING" && tableGroups.length > 0;
  const canMarkGroupFailed = activity.status === "REGISTRATION_OPEN"
    && candidates !== null
    && candidates.length < activity.minSize
    && Date.now() >= new Date(activity.registrationEndsAt).getTime();

  return (
    <section className="grouping-panel" aria-label="规则排桌操作区">
      <SectionHeader title="规则排桌" subtitle="先预览已支付候选人，再生成草案；最终仍需运营人工确认。" stamp="TABLE" />
      <div className="grouping-summary">
        <span>候选人数</span>
        <strong>{candidates?.length ?? "加载中"}</strong>
        <span>活动状态：{activity.status}</span>
      </div>
      <div className="candidate-list">
        {candidates?.map((candidate) => (
          <article className="candidate-card" key={candidate.order.id}>
            <strong>{candidate.order.id}</strong>
            {candidate.profile ? (
              <span>{formatCandidateProfile(candidate.profile)}</span>
            ) : (
              <span>未填写问卷</span>
            )}
          </article>
        ))}
      </div>
      {tableGroups.length > 0 ? (
        <div className="grouping-draft">
          <strong>草案已生成：{tableGroups.map((group) => `${group.orderIds.length} 人`).join(" + ")}</strong>
          <span>待人工确认后才会更新成团状态。</span>
          <label className="group-adjustment-label" htmlFor="table-group-adjustment">人工调整（每行一桌，以逗号分隔订单号）</label>
          <textarea
            aria-label="人工调整桌位"
            className="group-adjustment-input"
            id="table-group-adjustment"
            value={adjustmentText}
            onChange={(event) => setAdjustmentText(event.target.value)}
          />
          <button
            className="ops-button ops-button--secondary"
            disabled={busy}
            type="button"
            onClick={() => {
              const adjustedGroups = adjustmentText
                .split("\n")
                .map((line) => ({ orderIds: line.split(",").map((orderId) => orderId.trim()).filter(Boolean) }))
                .filter((group) => group.orderIds.length > 0);
              void onAdjust(activity.id, adjustedGroups);
            }}
          >
            保存人工调整
          </button>
        </div>
      ) : null}
      <div className="grouping-actions">
        <button className="ops-button ops-button--secondary" disabled={!canDraft || busy} type="button" onClick={() => void onDraft(activity.id)}>
          {busy ? "处理中…" : "生成规则草案"}
        </button>
        <button className="ops-button ops-button--primary" disabled={!canConfirm || busy} type="button" onClick={() => void onConfirm(activity.id)}>
          人工确认成团
        </button>
      </div>
      {canMarkGroupFailed ? (
        <div className="group-failure-panel">
          <strong>报名已截止，当前人数不足 {activity.minSize} 人</strong>
          <span>标记后订单仅进入“成团失败”，不会自动创建退款或调用退款渠道。</span>
          <div className="report-actions">
            <input aria-label="成团失败原因" className="report-reason" value={failureReason} maxLength={200} onChange={(event) => setFailureReason(event.target.value)} placeholder="填写人工处置原因" />
            <button className="ops-button ops-button--secondary" disabled={!failureReason.trim() || busy} type="button" onClick={() => void onMarkGroupFailed(activity.id, failureReason)}>
              标记成团失败
            </button>
          </div>
        </div>
      ) : null}
    </section>
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
