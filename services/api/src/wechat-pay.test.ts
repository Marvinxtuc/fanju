import { createCipheriv, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPaymentNotification, verifyRefundNotification } from "./wechat-pay.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const FIXTURE_KEY = "0123456789abcdef0123456789abcdef";
const NOW_SECONDS = 1_800_000_000;

describe("WeChat Pay v3 notifications", () => {
  it("verifies and decrypts a successful payment notification", () => {
    const fixture = signedNotification({ out_trade_no: "pay_local_001", transaction_id: "wechat_transaction_001", trade_state: "SUCCESS", amount: { total: 9900 } });
    expect(verifyPaymentNotification(fixture.body, fixture.headers, config())).toEqual({ merchantOrderNo: "pay_local_001", channelTradeNo: "wechat_transaction_001", amountCents: 9900, callbackNonce: "notification-nonce" });
  });

  it("rejects altered bodies and stale timestamps before state can change", () => {
    const fixture = signedNotification({ out_trade_no: "pay_local_002", transaction_id: "wechat_transaction_002", trade_state: "SUCCESS", amount: { total: 9900 } });
    expect(() => verifyPaymentNotification(`${fixture.body} `, fixture.headers, config())).toThrow(/signature verification failed/);
    expect(() => verifyPaymentNotification(fixture.body, fixture.headers, config({ now: () => 0 }))).toThrow(/timestamp/);
  });

  it("verifies and decrypts a successful refund notification", () => {
    const fixture = signedNotification({ out_refund_no: "refund_local_001", refund_id: "wechat_refund_001", refund_status: "SUCCESS", amount: { refund: 9900 } });
    expect(verifyRefundNotification(fixture.body, fixture.headers, config())).toEqual({ merchantRefundNo: "refund_local_001", channelRefundNo: "wechat_refund_001", amountCents: 9900, callbackNonce: "notification-nonce" });
  });
});

function config(overrides: Partial<{ now: () => number }> = {}) { return { apiV3Key: FIXTURE_KEY, platformCertificate: publicKey, now: () => NOW_SECONDS * 1000, ...overrides }; }

function signedNotification(resource: Record<string, unknown>) {
  const nonce = randomBytes(12).toString("base64url").slice(0, 12);
  const associatedData = "transaction";
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(FIXTURE_KEY), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associatedData));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(resource), "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
  const body = JSON.stringify({ resource: { associated_data: associatedData, nonce, ciphertext: encrypted } });
  const signer = createSign("RSA-SHA256");
  signer.update(`${NOW_SECONDS}\nnotification-nonce\n${body}\n`);
  signer.end();
  return { body, headers: { "wechatpay-timestamp": String(NOW_SECONDS), "wechatpay-nonce": "notification-nonce", "wechatpay-signature": signer.sign(privateKey, "base64") } };
}
