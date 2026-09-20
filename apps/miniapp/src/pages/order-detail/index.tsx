import { useEffect, useState } from "react";
import { Button, Input, Text, Textarea, View } from "@tarojs/components";
import { navigateTo } from "@tarojs/taro";

import { getLastOrder, getNotifications, submitOrderReport, submitOrderReview, type InboxNotification, type OrderDetail } from "../../api";

export default function OrderDetailPage(): JSX.Element {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [error, setError] = useState("");
  const [reportType, setReportType] = useState("现场异常");
  const [reportContent, setReportContent] = useState("");
  const [reportMessage, setReportMessage] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reviewScore, setReviewScore] = useState("5");
  const [reviewTags, setReviewTags] = useState("");
  const [reviewContent, setReviewContent] = useState("");
  const [reviewMessage, setReviewMessage] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load(): Promise<void> {
    try {
      setError("");
      const [nextOrder, nextNotifications] = await Promise.all([getLastOrder(), getNotifications()]);
      setOrder(nextOrder);
      setNotifications(nextNotifications);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "订单详情加载失败");
    }
  }

  async function submitReview(): Promise<void> {
    if (!order) return;
    try {
      setError("");
      setReviewMessage("");
      setReviewBusy(true);
      const score = Number(reviewScore);
      const tags = reviewTags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
      const review = await submitOrderReview(order.id, score, tags, reviewContent);
      setReviewMessage(`已保存 ${review.score} 分评价，仅供运营改进体验。`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交评价失败");
    } finally {
      setReviewBusy(false);
    }
  }

  async function submitReport(): Promise<void> {
    if (!order) return;
    try {
      setError("");
      setReportMessage("");
      setReportBusy(true);
      const report = await submitOrderReport(order.id, reportType, reportContent);
      setReportContent("");
      setReportMessage(`已提交，编号 ${report.id}，等待运营处理。`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交反馈失败");
    } finally {
      setReportBusy(false);
    }
  }

  const canReport = Boolean(order && Date.now() >= new Date(order.activity.endsAt).getTime());
  const canReview = order?.status === "COMPLETED";

  return (
    <View className="page page-order-detail">
      <View className="detail-header">
        <Text className="eyebrow">到店小票</Text>
        <Text className="title">{order ? "饭局已入票" : "暂无饭票"}</Text>
        <Text className="summary">订单金额由服务端计算；当前使用 mock 支付，不接生产真实支付。</Text>
      </View>

      {error ? <Text className="error-text">错误：{error}</Text> : null}

      <View className="ticket-card">
        <View className="ticket-row">
          <View>
            <Text className="ticket-label">ORDER</Text>
            <Text className="meal-card__title">{order?.id ?? "暂无订单"}</Text>
          </View>
          <Text className="stamp stamp--green">{order?.status ?? "-"}</Text>
        </View>
        <View className="ticket-divider" />
        <Text className="muted">服务费/订位费</Text>
        <Text className="amount">{order ? `¥${order.amountCents / 100}` : "-"}</Text>
        <Text className="muted">餐费到店自理</Text>
      </View>

      <View className="detail-block">
        <Text className="block-title">解锁信息</Text>
        <View className="menu-line">
          <Text>饭局</Text>
          <Text className="muted">{order?.activity.title ?? "-"}</Text>
        </View>
        <View className="menu-line">
          <Text>商户</Text>
          <Text className="muted">{order?.activity.restaurantName ?? "成团后展示"}</Text>
        </View>
        <View className="menu-line">
          <Text>地址</Text>
          <Text className="muted">{order?.activity.address ?? "活动前 24 小时展示"}</Text>
        </View>
      </View>

      <View className="detail-block">
        <Text className="block-title">取消规则</Text>
        <Text className="summary">T-24 前取消进入运营快速审核，审核通过后按测试退款流程处理。</Text>
      </View>

      <View className="detail-block">
        <Text className="block-title">活动反馈</Text>
        <Text className="summary">活动结束后 7 天内可提交，内容仅供运营处理，不会公开展示。</Text>
        {canReport ? (
          <>
            <Input className="report-input" value={reportType} maxlength={40} onInput={(event) => setReportType(event.detail.value)} placeholder="反馈类型" />
            <Textarea className="report-textarea" value={reportContent} maxlength={1000} onInput={(event) => setReportContent(event.detail.value)} placeholder="请描述需要运营跟进的情况" />
            {reportMessage ? <Text className="success-text">{reportMessage}</Text> : null}
            <Button className="button-secondary" disabled={!reportType.trim() || !reportContent.trim() || reportBusy} onClick={() => void submitReport()}>
              {reportBusy ? "提交中…" : "提交反馈"}
            </Button>
          </>
        ) : <Text className="muted">活动结束后将开放反馈入口。</Text>}
      </View>

      <View className="detail-block">
        <Text className="block-title">体验评价</Text>
        <Text className="summary">仅已完成的订单可评价；评价不公开展示，可再次提交更新内容。</Text>
        {canReview ? (
          <>
            <Input className="report-input" value={reviewScore} type="number" maxlength={1} onInput={(event) => setReviewScore(event.detail.value)} placeholder="1 至 5 分" />
            <Input className="report-input" value={reviewTags} maxlength={200} onInput={(event) => setReviewTags(event.detail.value)} placeholder="标签用逗号分隔，例如：菜品、氛围" />
            <Textarea className="report-textarea" value={reviewContent} maxlength={1000} onInput={(event) => setReviewContent(event.detail.value)} placeholder="可选：写下体验建议" />
            {reviewMessage ? <Text className="success-text">{reviewMessage}</Text> : null}
            <Button className="button-secondary" disabled={reviewBusy || !/^[1-5]$/.test(reviewScore)} onClick={() => void submitReview()}>
              {reviewBusy ? "保存中…" : "保存评价"}
            </Button>
          </>
        ) : <Text className="muted">活动完成后将开放评价入口。</Text>}
      </View>

      <View className="detail-block">
        <Text className="block-title">站内通知</Text>
        {notifications.length > 0 ? notifications.map((notification) => (
          <View className="notification-card" key={notification.id}>
            <Text className="notification-card__title">{notification.payload?.title ?? "活动状态更新"}</Text>
            <Text className="muted">{notification.payload?.message ?? "请留意订单状态。"}</Text>
          </View>
        )) : <Text className="muted">当前没有新的站内通知。</Text>}
      </View>

      <View className="action-bar">
        <Button className="button-primary" onClick={() => void load()}>
          刷新饭票
        </Button>
        <Button className="button-secondary" onClick={() => navigateTo({ url: "/pages/home/index" })}>
          返回饭局列表
        </Button>
      </View>
    </View>
  );
}
