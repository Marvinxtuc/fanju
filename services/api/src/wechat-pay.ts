import { createDecipheriv, createVerify } from "node:crypto";

export class WechatPayNotificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WechatPayNotificationError";
  }
}

export interface WechatPayNotificationConfig {
  apiV3Key: string;
  platformCertificate: string;
  maxTimestampSkewSeconds?: number;
  now?: () => number;
}

export interface VerifiedPaymentNotification {
  merchantOrderNo: string;
  channelTradeNo: string;
  amountCents: number;
  callbackNonce: string;
}

export interface VerifiedRefundNotification {
  merchantRefundNo: string;
  channelRefundNo: string;
  amountCents: number;
  callbackNonce: string;
}

type HeaderValues = Record<string, string | string[] | undefined>;

/** Routes must pass the exact raw request body; reconstructed JSON is unsafe. */
export function verifyPaymentNotification(rawBody: string, headers: HeaderValues, config: WechatPayNotificationConfig): VerifiedPaymentNotification {
  const notification = readAndDecrypt(rawBody, headers, config);
  if (notification.trade_state !== "SUCCESS") throw new WechatPayNotificationError("Payment notification is not successful");
  return {
    merchantOrderNo: requiredString(notification.out_trade_no, "out_trade_no"),
    channelTradeNo: requiredString(notification.transaction_id, "transaction_id"),
    amountCents: requiredAmount(notification.amount, "total"),
    callbackNonce: requiredHeader(headers, "wechatpay-nonce"),
  };
}

export function verifyRefundNotification(rawBody: string, headers: HeaderValues, config: WechatPayNotificationConfig): VerifiedRefundNotification {
  const notification = readAndDecrypt(rawBody, headers, config);
  if (notification.refund_status !== "SUCCESS") throw new WechatPayNotificationError("Refund notification is not successful");
  return {
    merchantRefundNo: requiredString(notification.out_refund_no, "out_refund_no"),
    channelRefundNo: requiredString(notification.refund_id, "refund_id"),
    amountCents: requiredAmount(notification.amount, "refund"),
    callbackNonce: requiredHeader(headers, "wechatpay-nonce"),
  };
}

function readAndDecrypt(rawBody: string, headers: HeaderValues, config: WechatPayNotificationConfig): Record<string, unknown> {
  verifySignature(rawBody, headers, config);
  const envelope = asRecord(parseJson(rawBody, "notification envelope"));
  const resource = asRecord(envelope.resource);
  const ciphertext = requiredString(resource.ciphertext, "resource.ciphertext");
  const nonce = requiredString(resource.nonce, "resource.nonce");
  const associatedData = resource.associated_data === undefined ? "" : requiredString(resource.associated_data, "resource.associated_data");
  const key = Buffer.from(config.apiV3Key, "utf8");
  if (key.length !== 32) throw new WechatPayNotificationError("WECHAT_PAY_API_V3_KEY must be 32 bytes");
  const packed = Buffer.from(ciphertext, "base64");
  if (packed.length <= 16) throw new WechatPayNotificationError("Notification ciphertext is invalid");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "utf8"));
    decipher.setAuthTag(packed.subarray(-16));
    decipher.setAAD(Buffer.from(associatedData, "utf8"));
    const plaintext = Buffer.concat([decipher.update(packed.subarray(0, -16)), decipher.final()]).toString("utf8");
    return asRecord(parseJson(plaintext, "notification resource"));
  } catch (error) {
    if (error instanceof WechatPayNotificationError) throw error;
    throw new WechatPayNotificationError("Notification resource decryption failed");
  }
}

function verifySignature(rawBody: string, headers: HeaderValues, config: WechatPayNotificationConfig): void {
  const timestamp = requiredHeader(headers, "wechatpay-timestamp");
  const nonce = requiredHeader(headers, "wechatpay-nonce");
  const signature = requiredHeader(headers, "wechatpay-signature");
  const timestampSeconds = Number(timestamp);
  const now = config.now ?? Date.now;
  const maxSkew = config.maxTimestampSkewSeconds ?? 300;
  if (!Number.isInteger(timestampSeconds) || Math.abs(now() / 1000 - timestampSeconds) > maxSkew) throw new WechatPayNotificationError("Notification timestamp is outside the allowed window");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${timestamp}\n${nonce}\n${rawBody}\n`);
  verifier.end();
  if (!verifier.verify(config.platformCertificate, signature, "base64")) throw new WechatPayNotificationError("Notification signature verification failed");
}

function requiredHeader(headers: HeaderValues, name: string): string {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  const value = Array.isArray(direct) ? direct[0] : direct;
  if (!value) throw new WechatPayNotificationError(`Missing ${name} header`);
  return value;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new WechatPayNotificationError(`Notification is missing ${name}`);
  return value;
}

function requiredAmount(value: unknown, field: string): number {
  const amount = asRecord(value)[field];
  if (
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount < 0
  ) {
    throw new WechatPayNotificationError(`Notification amount.${field} is invalid`);
  }
  return amount;
}

function parseJson(value: string, name: string): unknown {
  try { return JSON.parse(value); } catch { throw new WechatPayNotificationError(`Invalid ${name}`); }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new WechatPayNotificationError("Notification payload is invalid");
  return value as Record<string, unknown>;
}
