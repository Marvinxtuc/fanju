import { describe, expect, it } from "vitest";
import { createWechatProviders, ProviderConfigError } from "./providers.js";

describe("wechat provider configuration", () => {
  it("defaults to mock providers in local development", () => {
    const providers = createWechatProviders({
      NODE_ENV: "development",
      APP_ENV: "local",
    });

    expect(providers.auth.mode).toBe("mock");
    expect(providers.phone.mode).toBe("mock");
    expect(providers.payment.mode).toBe("mock");
    expect(providers.refund.mode).toBe("mock");
  });

  it("rejects mock payment in production unless explicitly allowed", () => {
    expect(() =>
      createWechatProviders({
        NODE_ENV: "production",
        APP_ENV: "production",
        PAYMENT_PROVIDER: "mock",
      }),
    ).toThrow(ProviderConfigError);
  });

  it("rejects wechat payment provider when required config is missing", () => {
    expect(() =>
      createWechatProviders({
        NODE_ENV: "development",
        APP_ENV: "local",
        PAYMENT_PROVIDER: "wechat",
        WECHAT_PAY_ENABLED: "true",
      }),
    ).toThrow(/Missing required WeChat Pay configuration/);
  });

  it("rejects wechat auth provider when miniapp config is missing", () => {
    expect(() =>
      createWechatProviders({
        AUTH_PROVIDER: "wechat",
        PAYMENT_PROVIDER: "mock",
      }),
    ).toThrow(/Missing required WeChat Mini Program configuration/);
  });

  it("exchanges wechat login code with the jscode2session endpoint", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const providers = createWechatProviders(
      {
        AUTH_PROVIDER: "wechat",
        WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
        WECHAT_MINIAPP_APP_SECRET: "wx_test_secret",
        PAYMENT_PROVIDER: "mock",
      },
      {
        httpClient: async (request) => {
          calls.push({ url: request.url, method: request.method ?? "GET" });
          return { openid: "mock_provider_openid_a", unionid: "mock_union_a" };
        },
      },
    );

    const identity = await providers.auth.exchangeLoginCode({ code: "login-code" });

    expect(identity).toEqual({
      provider: "wechat",
      openid: "mock_provider_openid_a",
      unionid: "mock_union_a",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toContain("/sns/jscode2session");
    expect(calls[0]?.url).toContain("grant_type=authorization_code");
    expect(calls[0]?.url).not.toContain("session_key");
  });

  it("rejects wechat auth errors without falling back to mock", async () => {
    const providers = createWechatProviders(
      {
        AUTH_PROVIDER: "wechat",
        WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
        WECHAT_MINIAPP_APP_SECRET: "wx_test_secret",
        PAYMENT_PROVIDER: "mock",
      },
      {
        httpClient: async () => ({ errcode: 40029, errmsg: "invalid code" }),
      },
    );

    await expect(
      providers.auth.exchangeLoginCode({ code: "bad-code" }),
    ).rejects.toThrow(/WeChat auth failed with errcode 40029/);
  });

  it("rejects empty wechat login code before calling the channel", async () => {
    let called = false;
    const providers = createWechatProviders(
      {
        AUTH_PROVIDER: "wechat",
        WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
        WECHAT_MINIAPP_APP_SECRET: "wx_test_secret",
        PAYMENT_PROVIDER: "mock",
      },
      {
        httpClient: async () => {
          called = true;
          return {};
        },
      },
    );

    await expect(
      providers.auth.exchangeLoginCode({ code: "" }),
    ).rejects.toThrow(/WeChat login code is required/);
    expect(called).toBe(false);
  });

  it("exchanges wechat phone code with access token and getuserphonenumber", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const providers = createWechatProviders(
      {
        PHONE_PROVIDER: "wechat",
        WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
        WECHAT_MINIAPP_APP_SECRET: "wx_test_secret",
        PAYMENT_PROVIDER: "mock",
      },
      {
        httpClient: async (request) => {
          calls.push(request);
          if (request.url.includes("/cgi-bin/token")) {
            return { access_token: "mock_access_token", expires_in: 7200 };
          }
          return {
            errcode: 0,
            errmsg: "ok",
            phone_info: {
              phoneNumber: "13500135000",
              purePhoneNumber: "13500135000",
              countryCode: "86",
            },
          };
        },
      },
    );

    const result = await providers.phone.resolvePhone({ code: "phone-code" });

    expect(result).toEqual({
      provider: "wechat",
      phone: "13500135000",
      phoneNumber: "13500135000",
      purePhoneNumber: "13500135000",
      countryCode: "86",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain("/cgi-bin/token");
    expect(calls[1]?.url).toContain("/wxa/business/getuserphonenumber");
    expect(calls[1]?.method).toBe("POST");
    expect(calls[1]?.body).toEqual({ code: "phone-code" });
  });

  it("rejects wechat phone errors without returning a mock phone", async () => {
    const providers = createWechatProviders(
      {
        PHONE_PROVIDER: "wechat",
        WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
        WECHAT_MINIAPP_APP_SECRET: "wx_test_secret",
        PAYMENT_PROVIDER: "mock",
      },
      {
        httpClient: async (request) => {
          if (request.url.includes("/cgi-bin/token")) {
            return { access_token: "mock_access_token", expires_in: 7200 };
          }
          return { errcode: 40029, errmsg: "invalid code" };
        },
      },
    );

    await expect(
      providers.phone.resolvePhone({ code: "bad-phone-code" }),
    ).rejects.toThrow(/WeChat phone failed with errcode 40029/);
  });

  it("does not fall back from wechat auth provider to mock", async () => {
    const providers = createWechatProviders(
      {
        AUTH_PROVIDER: "wechat",
        WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
        WECHAT_MINIAPP_APP_SECRET: "wx_test_secret",
        PAYMENT_PROVIDER: "mock",
      },
      {
        httpClient: async () => ({ errcode: 40029, errmsg: "invalid code" }),
      },
    );

    await expect(providers.auth.exchangeLoginCode({ code: "code" })).rejects.toThrow(
      /WeChat auth failed with errcode 40029/,
    );
  });

  it("does not silently succeed when wechat payment provider is configured", async () => {
    const providers = createWechatProviders({
      PAYMENT_PROVIDER: "wechat",
      REFUND_PROVIDER: "wechat",
      WECHAT_PAY_ENABLED: "true",
      WECHAT_PAY_MCH_ID: "test_mch_id",
      WECHAT_PAY_API_V3_KEY: "test_api_v3_key",
      WECHAT_PAY_PRIVATE_KEY_PATH: "/tmp/test-wechat-pay-key.pem",
      WECHAT_PAY_CERT_SERIAL_NO: "test_cert_serial",
      WECHAT_PAY_CALLBACK_URL: "https://example.invalid/pay",
      WECHAT_REFUND_CALLBACK_URL: "https://example.invalid/refund",
    });

    expect(providers.payment.mode).toBe("wechat");
    expect(providers.refund.mode).toBe("wechat");
    await expect(
      providers.payment.createPayment({ orderId: "order", amountCents: 9900 }),
    ).rejects.toThrow(/WeChat payment provider is not implemented/);
    await expect(
      providers.refund.applySuccessCallback({ refundId: "refund" }),
    ).rejects.toThrow(/WeChat refund callback provider is not implemented/);
  });
});
