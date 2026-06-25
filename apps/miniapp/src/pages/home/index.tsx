import { useEffect, useState } from "react";
import { Button, ScrollView, Text, View } from "@tarojs/components";
import { navigateTo } from "@tarojs/taro";

import { listActivities, type ActivitySummary } from "../../api.js";

export default function HomePage(): JSX.Element {
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    void load();
  }, []);

  async function load(): Promise<void> {
    try {
      setError("");
      setActivities(await listActivities());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "活动列表加载失败");
    }
  }

  return (
    <ScrollView className="page page-home" scrollY>
      <View className="hero">
        <Text className="eyebrow">上海本地餐厅兴趣体验</Text>
        <Text className="title">本周可报名餐桌</Text>
        <Text className="summary">浏览活动、确认规则、完成测试支付后查看订单状态。</Text>
      </View>

      {error ? <Text>错误：{error}</Text> : null}

      <View className="section">
        {activities.map((activity) => (
          <View className="activity-card" key={activity.id}>
            <View className="activity-card__main">
              <Text className="activity-card__title">{activity.title}</Text>
              <Text className="activity-card__meta">
                {activity.district} / {activity.businessArea}
              </Text>
              <Text className="activity-card__meta">{activity.startsAt}</Text>
            </View>
            <View className="activity-card__aside">
              <Text className="activity-card__status">{activity.status}</Text>
              <Text className="activity-card__fee">服务费 {activity.serviceFeeCents / 100} 元</Text>
            </View>
            <Button
              className="activity-card__action"
              onClick={() => navigateTo({ url: `/pages/activity-detail/index?id=${activity.id}` })}
            >
              查看详情
            </Button>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
