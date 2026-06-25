import { useEffect, useState } from "react";
import { Button, Text, View } from "@tarojs/components";
import { navigateTo } from "@tarojs/taro";

import { getLastOrder, type OrderDetail } from "../../api.js";

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
      <Text className="eyebrow">订单详情</Text>
      <Text className="title">{order ? `订单 ${order.id}` : "暂无订单"}</Text>
      <Text className="summary">订单金额由服务端计算；当前使用 mock 支付。</Text>

      {error ? <Text>错误：{error}</Text> : null}

      <View className="detail-block">
        <Text className="block-title">费用</Text>
        <Text>服务费/订位费：{order ? order.amountCents / 100 : "-"} 元</Text>
        <Text>餐费：到店自理</Text>
      </View>

      <View className="detail-block">
        <Text className="block-title">状态</Text>
        <Text>{order?.status ?? "-"}</Text>
        <Text>{order?.activity.title ?? "-"}</Text>
        <Text>商户：{order?.activity.restaurantName ?? "成团后展示"}</Text>
        <Text>地址：{order?.activity.address ?? "活动前 24 小时展示"}</Text>
      </View>

      <View className="detail-block">
        <Text className="block-title">取消规则</Text>
        <Text>T-24 前取消进入运营快速审核，审核通过后按测试退款流程处理。</Text>
      </View>

      <Button onClick={() => void load()}>刷新订单</Button>
      <Button onClick={() => navigateTo({ url: "/pages/home/index" })}>返回活动列表</Button>
    </View>
  );
}
