import { useEffect, useState } from "react";
import { Button, Text, View } from "@tarojs/components";
import { navigateTo } from "@tarojs/taro";

import { getLastOrder, type OrderDetail } from "../../api";

export default function OrderDetailPage(): JSX.Element {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void load();
  }, []);

  async function load(): Promise<void> {
    try {
      setError("");
      setOrder(await getLastOrder());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "订单详情加载失败");
    }
  }

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
