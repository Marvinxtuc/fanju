import { useEffect, useState } from "react";
import { Button, Text, View } from "@tarojs/components";
import Taro, { navigateTo } from "@tarojs/taro";

import {
  createAndPayOrder,
  getActivity,
  type ActivitySummary,
} from "../../api.js";

const checklist = ["确认活动时间", "阅读取消规则", "费用为服务费/订位费"];

export default function ActivityDetailPage(): JSX.Element {
  const activityId = Taro.getCurrentInstance().router?.params.id ?? "";
  const [activity, setActivity] = useState<ActivitySummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        setError("");
        setActivity(await getActivity(activityId));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "活动详情加载失败");
      }
    }
    void load();
  }, [activityId]);

  async function handleCreateOrder(): Promise<void> {
    try {
      setError("");
      await createAndPayOrder(activityId);
      await navigateTo({ url: "/pages/order-detail/index" });
    } catch (orderError) {
      setError(orderError instanceof Error ? orderError.message : "报名或测试支付失败");
    }
  }

  return (
    <View className="page page-activity-detail">
      <View className="detail-header">
        <Text className="eyebrow">活动详情</Text>
        <Text className="title">{activity?.title ?? "加载中"}</Text>
        <Text className="summary">餐厅兴趣体验，成团后按规则解锁商户与地址信息。</Text>
      </View>

      {error ? <Text>错误：{error}</Text> : null}

      <View className="detail-block">
        <Text className="block-title">基本信息</Text>
        <Text>时间：{activity?.startsAt ?? "-"}</Text>
        <Text>
          区域：{activity?.district ?? "-"} {activity?.businessArea ?? ""}
        </Text>
        <Text>费用：服务费/订位费 {activity ? activity.serviceFeeCents / 100 : "-"} 元</Text>
      </View>

      <View className="detail-block">
        <Text className="block-title">报名前置确认</Text>
        {checklist.map((item) => (
          <Text className="check-row" key={item}>
            {item}
          </Text>
        ))}
      </View>

      <View className="action-bar">
        <Button onClick={() => navigateTo({ url: "/pages/mock-auth/index" })}>Mock 登录</Button>
        <Button onClick={() => void handleCreateOrder()}>报名并测试支付</Button>
        <Button onClick={() => navigateTo({ url: "/pages/order-detail/index" })}>查看订单</Button>
      </View>
    </View>
  );
}
