import { useState } from "react";
import { Button, Text, View } from "@tarojs/components";
import { navigateTo } from "@tarojs/taro";

import {
  bindPhoneWithWechatCode,
  ensureMockUser,
  loginWithWechatProvider,
} from "../../api.js";

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
      <Text className="eyebrow">测试能力</Text>
      <Text className="title">Mock 登录与手机号授权</Text>
      <Text className="summary">本页保留本地 mock 入口，并提供微信登录与手机号授权最小入口。</Text>

      <View className="detail-block">
        <Text className="block-title">模拟状态</Text>
        <Text>{message}</Text>
      </View>

      <Button onClick={() => void handleLogin()}>执行 Mock 登录</Button>
      <Button onClick={() => void handleWechatLogin()}>微信登录</Button>
      <Button openType="getPhoneNumber" onGetPhoneNumber={(event) => void handlePhoneAuth(event)}>
        手机号授权
      </Button>
      <Button onClick={() => navigateTo({ url: "/pages/order-detail/index" })}>继续到订单详情</Button>
    </View>
  );
}
