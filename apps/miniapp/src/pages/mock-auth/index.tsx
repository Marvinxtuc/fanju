import { useState } from "react";
import { Button, Text, View } from "@tarojs/components";
import { navigateTo } from "@tarojs/taro";

import {
  bindPhoneWithWechatCode,
  ensureMockUser,
  loginWithWechatProvider,
} from "../../api";

export default function MockAuthPage(): JSX.Element {
  const [message, setMessage] = useState("未登录");

  async function handleLogin(): Promise<void> {
    try {
      await ensureMockUser();
      setMessage("Mock 登录和手机号已完成");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Mock 登录失败");
    }
  }

  async function handleWechatLogin(): Promise<void> {
    try {
      await loginWithWechatProvider();
      setMessage("微信登录已完成");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "微信登录失败");
    }
  }

  async function handlePhoneAuth(event: unknown): Promise<void> {
    const detail = (event as { detail?: { code?: string; errMsg?: string } }).detail;
    if (!detail?.code) {
      setMessage(detail?.errMsg ? `手机号授权失败：${detail.errMsg}` : "手机号授权失败");
      return;
    }
    try {
      await bindPhoneWithWechatCode(detail.code);
      setMessage("手机号授权已完成");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "手机号授权失败");
    }
  }

  return (
    <View className="page page-mock-auth">
      <View className="detail-header">
        <Text className="eyebrow">测试能力</Text>
        <Text className="title">身份小票</Text>
        <Text className="summary">本页保留本地 mock 入口，并提供微信登录与手机号授权最小入口。</Text>
      </View>

      <View className="detail-block">
        <Text className="block-title">模拟状态</Text>
        <Text className="stamp stamp--green">{message}</Text>
      </View>

      <View className="safe-card">
        <Text className="safe-card__title">联调边界</Text>
        <Text className="summary">真实 AppSecret 和手机号样本不得写入 repo；失败路径不得 fallback 到 mock。</Text>
      </View>

      <View className="action-bar">
        <Button className="button-primary" onClick={() => void handleLogin()}>
          执行 Mock 登录
        </Button>
        <Button className="button-secondary" onClick={() => void handleWechatLogin()}>
          微信登录
        </Button>
        <Button className="button-secondary" openType="getPhoneNumber" onGetPhoneNumber={(event) => void handlePhoneAuth(event)}>
          手机号授权
        </Button>
        <Button className="button-quiet" onClick={() => navigateTo({ url: "/pages/order-detail/index" })}>
          继续到饭票
        </Button>
      </View>
    </View>
  );
}
