export type ProviderMode = "mock" | "wechat";

export interface ProviderEnv {
  [key: string]: string | undefined;
}

export interface ProviderHttpRequest {
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
}

export type ProviderHttpClient = (
  request: ProviderHttpRequest,
) => Promise<unknown>;

export interface ProviderOptions {
  httpClient?: ProviderHttpClient;
}

export interface AuthProvider {
  mode: ProviderMode;
  exchangeLoginCode(input: { code: string }): Promise<{
    provider: ProviderMode;
    openid: string;
    unionid?: string;
  }>;
}

export interface PhoneProvider {
  mode: ProviderMode;
  resolvePhone(input: { phone?: string; code?: string }): Promise<{
    provider: ProviderMode;
    phone: string;
    phoneNumber: string;
    countryCode?: string;
    purePhoneNumber?: string;
  }>;
}

export interface PaymentProvider {
  mode: ProviderMode;
  createPayment(input: {
    orderId: string;
    amountCents: number;
  }): Promise<{
    channel: string;
  }>;
  applySuccessCallback(input: { paymentId: string }): Promise<{
    channelTradeNo: string;
    callbackNonce: string;
  }>;
}

export interface RefundProvider {
  mode: ProviderMode;
  applySuccessCallback(input: { refundId: string }): Promise<{
    channelRefundNo: string;
    callbackNonce: string;
  }>;
  applyFailureCallback(input: { refundId: string; reason: string }): Promise<{
    failureReason: string;
  }>;
}

export interface WechatProviders {
  auth: AuthProvider;
  phone: PhoneProvider;
  payment: PaymentProvider;
  refund: RefundProvider;
}

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export function createWechatProviders(
  env: ProviderEnv = process.env,
  options: ProviderOptions = {},
): WechatProviders {
  const authMode = readMode(env.AUTH_PROVIDER, "mock", "AUTH_PROVIDER");
  const phoneMode = readMode(env.PHONE_PROVIDER, "mock", "PHONE_PROVIDER");
  const paymentMode = readMode(
    env.PAYMENT_PROVIDER ?? env.WECHAT_PAY_MODE,
    "mock",
    "PAYMENT_PROVIDER",
  );
  const refundMode = readMode(
    env.REFUND_PROVIDER ?? env.PAYMENT_PROVIDER ?? env.WECHAT_PAY_MODE,
    paymentMode,
    "REFUND_PROVIDER",
  );

  if (authMode === "wechat" || phoneMode === "wechat") {
    assertWechatMiniappConfig(env);
  }
  assertProductionPaymentMode(env, paymentMode);
  if (paymentMode === "wechat" || refundMode === "wechat") {
    assertWechatPayConfig(env);
  }
  const httpClient = options.httpClient ?? fetchJson;

  return {
    auth:
      authMode === "mock"
        ? new MockAuthProvider()
        : new WechatAuthProvider(env, httpClient),
    phone:
      phoneMode === "mock"
        ? new MockPhoneProvider()
        : new WechatPhoneProvider(env, httpClient),
    payment:
      paymentMode === "mock" ? new MockPaymentProvider() : new WechatPaymentProvider(),
    refund:
      refundMode === "mock" ? new MockRefundProvider() : new WechatRefundProvider(),
  };
}

function readMode(
  value: string | undefined,
  fallback: ProviderMode,
  name: string,
): ProviderMode {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (value === "mock" || value === "wechat") {
    return value;
  }
  throw new ProviderConfigError(`${name} must be mock or wechat`);
}

function assertProductionPaymentMode(env: ProviderEnv, mode: ProviderMode): void {
  const isProduction =
    env.NODE_ENV === "production" || env.APP_ENV === "production";
  const allowMockPayment =
    env.ALLOW_MOCK_PAYMENT_IN_PRODUCTION === "true" ||
    env.WECHAT_PAY_MOCK_ENABLED_IN_PRODUCTION === "true";
  if (isProduction && mode === "mock" && !allowMockPayment) {
    throw new ProviderConfigError(
      "Mock payment provider is disabled in production unless explicitly allowed",
    );
  }
}

function assertWechatMiniappConfig(env: ProviderEnv): void {
  const required = ["WECHAT_MINIAPP_APP_ID", "WECHAT_MINIAPP_APP_SECRET"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new ProviderConfigError(
      `Missing required WeChat Mini Program configuration: ${missing.join(", ")}`,
    );
  }
}

function assertWechatPayConfig(env: ProviderEnv): void {
  const enabled = env.WECHAT_PAY_ENABLED === "true";
  const required = [
    "WECHAT_PAY_MCH_ID",
    "WECHAT_PAY_API_V3_KEY",
    "WECHAT_PAY_PRIVATE_KEY_PATH",
    "WECHAT_PAY_CERT_SERIAL_NO",
    "WECHAT_PAY_CALLBACK_URL",
    "WECHAT_REFUND_CALLBACK_URL",
  ];
  const missing = [
    ...(enabled ? [] : ["WECHAT_PAY_ENABLED=true"]),
    ...required.filter((key) => !env[key]),
  ];
  if (missing.length > 0) {
    throw new ProviderConfigError(
      `Missing required WeChat Pay configuration: ${missing.join(", ")}`,
    );
  }
}

class MockAuthProvider implements AuthProvider {
  readonly mode = "mock" as const;

  async exchangeLoginCode(input: { code: string }) {
    return { provider: this.mode, openid: `mock_openid_${input.code}` };
  }
}

class WechatAuthProvider implements AuthProvider {
  readonly mode = "wechat" as const;

  constructor(
    private readonly env: ProviderEnv,
    private readonly httpClient: ProviderHttpClient,
  ) {}

  async exchangeLoginCode(input: { code: string }): Promise<{
    provider: ProviderMode;
    openid: string;
    unionid?: string;
  }> {
    const code = input.code.trim();
    if (!code) {
      throw new ProviderUnavailableError("WeChat login code is required");
    }
    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    url.searchParams.set(
      "appid",
      requireConfigValue(this.env, "WECHAT_MINIAPP_APP_ID"),
    );
    url.searchParams.set(
      "secret",
      requireConfigValue(this.env, "WECHAT_MINIAPP_APP_SECRET"),
    );
    url.searchParams.set("js_code", code);
    url.searchParams.set("grant_type", "authorization_code");

    const response = asRecord(
      await this.httpClient({ url: url.toString(), method: "GET" }),
    );
    throwIfWechatError(response, "auth");
    const openid = response.openid;
    if (typeof openid !== "string" || openid.length === 0) {
      throw new ProviderUnavailableError("WeChat auth response missing openid");
    }
    const unionid = typeof response.unionid === "string" ? response.unionid : undefined;
    return unionid === undefined
      ? { provider: this.mode, openid }
      : { provider: this.mode, openid, unionid };
  }
}

class MockPhoneProvider implements PhoneProvider {
  readonly mode = "mock" as const;

  async resolvePhone(input: { phone?: string }) {
    if (!input.phone) {
      throw new ProviderUnavailableError("Mock phone provider requires phone");
    }
    return { provider: this.mode, phone: input.phone, phoneNumber: input.phone };
  }
}

class WechatPhoneProvider implements PhoneProvider {
  readonly mode = "wechat" as const;

  constructor(
    private readonly env: ProviderEnv,
    private readonly httpClient: ProviderHttpClient,
  ) {}

  async resolvePhone(input: { code?: string }): Promise<{
    provider: ProviderMode;
    phone: string;
    phoneNumber: string;
    countryCode?: string;
    purePhoneNumber?: string;
  }> {
    const code = input.code?.trim();
    if (!code) {
      throw new ProviderUnavailableError("WeChat phone authorization code is required");
    }

    const credential = await this.fetchAccessToken();
    const url = new URL(
      "https://api.weixin.qq.com/wxa/business/getuserphonenumber",
    );
    url.searchParams.set("access_token", credential);
    const response = asRecord(
      await this.httpClient({
        url: url.toString(),
        method: "POST",
        body: { code },
      }),
    );
    throwIfWechatError(response, "phone");
    const phoneInfo = asRecord(response.phone_info);
    const phoneNumber = phoneInfo.phoneNumber;
    if (typeof phoneNumber !== "string" || phoneNumber.length === 0) {
      throw new ProviderUnavailableError("WeChat phone response missing phone number");
    }
    const countryCode =
      phoneInfo.countryCode === undefined ? undefined : String(phoneInfo.countryCode);
    const purePhoneNumber =
      phoneInfo.purePhoneNumber === undefined
        ? undefined
        : String(phoneInfo.purePhoneNumber);
    return {
      provider: this.mode,
      phone: phoneNumber,
      phoneNumber,
      ...(countryCode === undefined ? {} : { countryCode }),
      ...(purePhoneNumber === undefined ? {} : { purePhoneNumber }),
    };
  }

  private async fetchAccessToken(): Promise<string> {
    const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
    url.searchParams.set("grant_type", "client_credential");
    url.searchParams.set(
      "appid",
      requireConfigValue(this.env, "WECHAT_MINIAPP_APP_ID"),
    );
    url.searchParams.set(
      "secret",
      requireConfigValue(this.env, "WECHAT_MINIAPP_APP_SECRET"),
    );
    const response = asRecord(
      await this.httpClient({ url: url.toString(), method: "GET" }),
    );
    throwIfWechatError(response, "phone access token");
    const credential = response.access_token;
    if (typeof credential !== "string" || credential.length === 0) {
      throw new ProviderUnavailableError("WeChat access token response missing token");
    }
    return credential;
  }
}

class MockPaymentProvider implements PaymentProvider {
  readonly mode = "mock" as const;

  async createPayment() {
    return { channel: "mock" };
  }

  async applySuccessCallback(input: { paymentId: string }) {
    return {
      channelTradeNo: `mock_trade_${input.paymentId}`,
      callbackNonce: `mock_payment_success_${input.paymentId}`,
    };
  }
}

class WechatPaymentProvider implements PaymentProvider {
  readonly mode = "wechat" as const;

  async createPayment(): Promise<{ channel: string }> {
    throw new ProviderUnavailableError(
      "WeChat payment provider is not implemented in M3.0",
    );
  }

  async applySuccessCallback(): Promise<{
    channelTradeNo: string;
    callbackNonce: string;
  }> {
    throw new ProviderUnavailableError(
      "WeChat payment callback provider is not implemented in M3.0",
    );
  }
}

class MockRefundProvider implements RefundProvider {
  readonly mode = "mock" as const;

  async applySuccessCallback(input: { refundId: string }) {
    return {
      channelRefundNo: `mock_refund_${input.refundId}`,
      callbackNonce: `mock_refund_success_${input.refundId}`,
    };
  }

  async applyFailureCallback(input: { reason: string }) {
    return { failureReason: input.reason };
  }
}

class WechatRefundProvider implements RefundProvider {
  readonly mode = "wechat" as const;

  async applySuccessCallback(): Promise<{
    channelRefundNo: string;
    callbackNonce: string;
  }> {
    throw new ProviderUnavailableError(
      "WeChat refund callback provider is not implemented in M3.0",
    );
  }

  async applyFailureCallback(): Promise<{ failureReason: string }> {
    throw new ProviderUnavailableError(
      "WeChat refund callback provider is not implemented in M3.0",
    );
  }
}

function requireConfigValue(env: ProviderEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new ProviderConfigError(`Missing required WeChat configuration: ${key}`);
  }
  return value;
}

async function fetchJson(request: ProviderHttpRequest): Promise<unknown> {
  const method = request.method ?? "GET";
  const init: RequestInit = { method };
  if (request.body !== undefined) {
    init.body = JSON.stringify(request.body);
    init.headers = { "content-type": "application/json" };
  }
  const response = await fetch(request.url, init);
  if (!response.ok) {
    throw new ProviderUnavailableError(
      `WeChat channel request failed with status ${response.status}`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new ProviderUnavailableError("WeChat channel returned invalid JSON");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    throw new ProviderUnavailableError("WeChat channel returned invalid payload");
  }
  return value as Record<string, unknown>;
}

function throwIfWechatError(
  response: Record<string, unknown>,
  capability: string,
): void {
  const errcode = response.errcode;
  if (typeof errcode === "number" && errcode !== 0) {
    throw new ProviderUnavailableError(
      `WeChat ${capability} failed with errcode ${errcode}`,
    );
  }
}
