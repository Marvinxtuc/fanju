import {
  ActivityStatus,
  OrderStatus,
  PrismaClient,
  RefundStatus,
} from "./generated/prisma/client.js";
import { createCipheriv, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://timeleft:timeleft_dev_password@localhost:5432/timeleft_shanghai?schema=public";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const describeDb = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const testRunPrefix = `api_db_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const { privateKey: callbackPrivateKey, publicKey: callbackPublicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const callbackFixtureKey = "0123456789abcdef0123456789abcdef";
const callbackNowSeconds = 1_800_000_000;

describeDb("api mock MVP flow", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  it("allows the operations console to preflight manual table-group adjustments", async () => {
    const response = await appInject({
      method: "OPTIONS",
      url: "/api/ops/activities/activity-1/table-groups",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "PUT",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("PUT");
  });

  beforeAll(async () => {
    await cleanupTestData();
    app = await buildApp({ prisma });
    appRef = app;
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await app.close();
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it("creates an order with server-side service fee and handles payment idempotently", async () => {
    const adminToken = await loginAdmin("ops-user");
    const userToken = await loginUser("buyer-1");
    await bindPhone(userToken, "13800138000");
    await confirmAgreement(userToken);
    const activityId = await createOpenActivity(adminToken);

    const orderResponse = await app.inject({
      method: "POST",
      url: "/api/orders",
      headers: auth(userToken),
      payload: {
        activityId,
        agreementVersion: "v1",
        amountCents: 1,
      },
    });
    expect(orderResponse.statusCode).toBe(200);
    const orderPayload = orderResponse.json();
    expect(orderPayload.order.amountCents).toBe(9900);

    const paymentResponse = await app.inject({
      method: "POST",
      url: "/api/mock/payments",
      headers: auth(userToken),
      payload: { orderId: orderPayload.order.id },
    });
    expect(paymentResponse.statusCode).toBe(200);
    const payment = paymentResponse.json().payment;

    const firstCallback = await app.inject({
      method: "POST",
      url: `/api/mock/payments/${payment.id}/succeed`,
    });
    expect(firstCallback.statusCode).toBe(200);
    expect(firstCallback.json().idempotent).toBe(false);

    const secondCallback = await app.inject({
      method: "POST",
      url: `/api/mock/payments/${payment.id}/succeed`,
    });
    expect(secondCallback.statusCode).toBe(200);
    expect(secondCallback.json().idempotent).toBe(true);

    const updatedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orderPayload.order.id },
    });
    expect(updatedOrder.status).toBe("PAID_PENDING_GROUP");
    const paymentAuditCount = await prisma.auditLog.count({
      where: {
        action: "payment.callback.succeeded",
        targetId: payment.id,
      },
    });
    expect(paymentAuditCount).toBe(1);
  });

  it("requires the order owner to confirm the current agreement before creating an order", async () => {
    const adminToken = await loginAdmin("agreement-ops");
    const userToken = await loginUser("agreement-user");
    await bindPhone(userToken, "13500209999");
    const activityId = await createOpenActivity(adminToken);

    const withoutAgreement = await appInject({
      method: "POST",
      url: "/api/orders",
      headers: auth(userToken),
      payload: { activityId, agreementVersion: "v1" },
    });
    expect(withoutAgreement.statusCode).toBe(409);
    expect(withoutAgreement.json().error).toBe("Agreement confirmation required");

    const confirmation = await appInject({
      method: "POST",
      url: "/api/consents",
      headers: auth(userToken),
      payload: { agreementVersion: "v1", source: "miniapp-registration" },
    });
    expect(confirmation.statusCode).toBe(200);

    const withAgreement = await appInject({
      method: "POST",
      url: "/api/orders",
      headers: auth(userToken),
      payload: { activityId, agreementVersion: "v1" },
    });
    expect(withAgreement.statusCode).toBe(200);
  });

  it("stores a complete profile for its owner and rejects incomplete submissions", async () => {
    const userToken = await loginUser("profile-owner");
    const initial = await app.inject({ method: "GET", url: "/api/profile", headers: auth(userToken) });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().profile).toBeNull();

    const invalid = await app.inject({
      method: "PUT",
      url: "/api/profile",
      headers: auth(userToken),
      payload: { preferredAreas: ["徐汇"] },
    });
    expect(invalid.statusCode).toBe(400);

    const saved = await app.inject({
      method: "PUT",
      url: "/api/profile",
      headers: auth(userToken),
      payload: profilePayload(),
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().profile).toMatchObject(profilePayload());

    const otherToken = await loginUser("profile-other");
    const other = await app.inject({ method: "GET", url: "/api/profile", headers: auth(otherToken) });
    expect(other.statusCode).toBe(200);
    expect(other.json().profile).toBeNull();
  });

  it("applies a signed payment callback once and rejects the route while real pay is disabled", async () => {
    const disabled = await app.inject({ method: "POST", url: "/api/wechat/pay/notify", payload: {} });
    expect(disabled.statusCode).toBe(404);

    const adminToken = await loginAdmin("callback-ops");
    const userToken = await loginUser("callback-buyer");
    await bindPhone(userToken, "13800138000");
    const orderId = await createPendingOrder(userToken, await createOpenActivity(adminToken));
    const payment = await createMockPayment(userToken, orderId);
    const wechatApp = await buildApp({
      prisma,
      providerEnv: wechatCallbackEnv(),
      wechatPayNotificationConfig: {
        apiV3Key: ["0123456789abcdef", "0123456789abcdef"].join(""),
        platformCertificate: callbackPublicKey,
        now: () => callbackNowSeconds * 1000,
      },
    });
    try {
      const fixture = signedWechatCallback({
        out_trade_no: payment.merchantOrderNo,
        transaction_id: "test_channel_trade_callback_001",
        trade_state: "SUCCESS",
        amount: { total: payment.amountCents },
      });
      const first = await wechatApp.inject({ method: "POST", url: "/api/wechat/pay/notify", headers: fixture.headers, payload: fixture.body });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ code: "SUCCESS", idempotent: false });
      const second = await wechatApp.inject({ method: "POST", url: "/api/wechat/pay/notify", headers: fixture.headers, payload: fixture.body });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ code: "SUCCESS", idempotent: true });
      await expectOrderStatus(orderId, OrderStatus.PAID_PENDING_GROUP);
    } finally {
      await wechatApp.close();
    }
  });

  it("applies a signed refund callback once after ops approval", async () => {
    const adminToken = await loginAdmin("refund-callback-ops");
    const userToken = await loginUser("refund-callback-buyer");
    await bindPhone(userToken, "13800138000");
    const orderId = await createPaidOrder(userToken, await createOpenActivity(adminToken));
    const cancel = await app.inject({
      method: "POST",
      url: `/api/orders/${orderId}/cancel`,
      headers: auth(userToken),
      payload: { reason: "测试退款回调" },
    });
    expect(cancel.statusCode).toBe(200);
    const refund = cancel.json().refund;
    const approve = await app.inject({
      method: "POST",
      url: `/api/ops/refunds/${refund.id}/approve`,
      headers: auth(adminToken),
      payload: { reason: "测试审核通过" },
    });
    expect(approve.statusCode).toBe(200);
    const wechatApp = await buildApp({
      prisma,
      providerEnv: wechatCallbackEnv(),
      wechatPayNotificationConfig: {
        apiV3Key: ["0123456789abcdef", "0123456789abcdef"].join(""),
        platformCertificate: callbackPublicKey,
        now: () => callbackNowSeconds * 1000,
      },
    });
    try {
      const fixture = signedWechatCallback({
        out_refund_no: refund.merchantRefundNo,
        refund_id: "test_channel_refund_callback_001",
        refund_status: "SUCCESS",
        amount: { refund: refund.amountCents },
      });
      const first = await wechatApp.inject({ method: "POST", url: "/api/wechat/refund/notify", headers: fixture.headers, payload: fixture.body });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ code: "SUCCESS", idempotent: false });
      const second = await wechatApp.inject({ method: "POST", url: "/api/wechat/refund/notify", headers: fixture.headers, payload: fixture.body });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ code: "SUCCESS", idempotent: true });
      await expectOrderStatus(orderId, OrderStatus.REFUNDED);
    } finally {
      await wechatApp.close();
    }
  });

  it("uses wechat auth provider results to create idempotent users", async () => {
    const wechatApp = await buildApp({
      prisma,
      providerEnv: {
        AUTH_PROVIDER: "wechat",
        PAYMENT_PROVIDER: "mock",
        WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
        WECHAT_MINIAPP_APP_SECRET: "wx_test_secret",
      },
      providerHttpClient: async (request) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("js_code");
        if (code === "bad-login-code") {
          return { errcode: 40029, errmsg: "invalid code" };
        }
        return {
          openid: `mock_openid_${testRunPrefix}_wechat_${code}`,
        };
      },
    });
    try {
      const concurrentLogins = await Promise.all(
        Array.from({ length: 3 }, () =>
          wechatApp.inject({
            method: "POST",
            url: "/api/mock/wechat-login",
            payload: { code: "same-login-code" },
          }),
        ),
      );
      expect(concurrentLogins.every((response) => response.statusCode === 200)).toBe(true);
      const userIds = new Set(concurrentLogins.map((response) => response.json().user.id));
      expect(userIds.size).toBe(1);
      const [firstUserId] = userIds;

      const different = await wechatApp.inject({
        method: "POST",
        url: "/api/mock/wechat-login",
        payload: { code: "different-login-code" },
      });
      expect(different.statusCode).toBe(200);
      expect(different.json().user.id).not.toBe(firstUserId);

      const beforeErrorCount = await prisma.user.count({
        where: { wechatOpenid: { startsWith: `mock_openid_${testRunPrefix}_wechat_` } },
      });
      const failed = await wechatApp.inject({
        method: "POST",
        url: "/api/mock/wechat-login",
        payload: { code: "bad-login-code" },
      });
      expect(failed.statusCode).toBe(503);
      const afterErrorCount = await prisma.user.count({
        where: { wechatOpenid: { startsWith: `mock_openid_${testRunPrefix}_wechat_` } },
      });
      expect(afterErrorCount).toBe(beforeErrorCount);
    } finally {
      await wechatApp.close();
    }
  });

  it("uses wechat phone provider results and preserves existing phone on failure", async () => {
    const wechatApp = await buildApp({
      prisma,
      providerEnv: {
        PHONE_PROVIDER: "wechat",
        PAYMENT_PROVIDER: "mock",
        WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
        WECHAT_MINIAPP_APP_SECRET: "wx_test_secret",
      },
      providerHttpClient: async (request) => {
        if (request.url.includes("/cgi-bin/token")) {
          return { access_token: "mock_access_token", expires_in: 7200 };
        }
        const body = request.body as { code?: string };
        if (body.code === "bad-phone-code") {
          return { errcode: 40029, errmsg: "invalid code" };
        }
        return {
          errcode: 0,
          errmsg: "ok",
          phone_info: {
            phoneNumber: "13500135099",
            purePhoneNumber: "13500135099",
            countryCode: "86",
          },
        };
      },
    });
    try {
      const login = await wechatApp.inject({
        method: "POST",
        url: "/api/mock/wechat-login",
        payload: { code: scoped("phone-provider-user") },
      });
      expect(login.statusCode).toBe(200);
      const token = login.json().token;
      const userId = login.json().user.id;

      const success = await wechatApp.inject({
        method: "POST",
        url: "/api/mock/phone",
        headers: auth(token),
        payload: { code: "good-phone-code" },
      });
      expect(success.statusCode).toBe(200);
      expect(success.json().user.phone).toBe("135****5099");
      const afterSuccess = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(afterSuccess.phone).toBe("13500135099");

      const repeat = await wechatApp.inject({
        method: "POST",
        url: "/api/mock/phone",
        headers: auth(token),
        payload: { code: "good-phone-code" },
      });
      expect(repeat.statusCode).toBe(200);

      const failed = await wechatApp.inject({
        method: "POST",
        url: "/api/mock/phone",
        headers: auth(token),
        payload: { code: "bad-phone-code" },
      });
      expect(failed.statusCode).toBe(503);
      const afterFailure = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(afterFailure.phone).toBe("13500135099");

      const unauthorized = await wechatApp.inject({
        method: "POST",
        url: "/api/mock/phone",
        payload: { code: "good-phone-code" },
      });
      expect(unauthorized.statusCode).toBe(401);
    } finally {
      await wechatApp.close();
    }
  });

  it("creates ops-review refunds for user cancellation and completes refund idempotently", async () => {
    const adminToken = await loginAdmin("refund-ops");
    const userToken = await loginUser("buyer-2");
    await bindPhone(userToken, "13900139000");
    const activityId = await createOpenActivity(adminToken);
    const orderId = await createPaidOrder(userToken, activityId);

    const cancelResponse = await app.inject({
      method: "POST",
      url: `/api/orders/${orderId}/cancel`,
      headers: auth(userToken),
      payload: { reason: "计划调整" },
    });
    expect(cancelResponse.statusCode).toBe(200);
    const refund = cancelResponse.json().refund;
    expect(refund.status).toBe("REVIEWING");
    const requestAuditCount = await prisma.auditLog.count({
      where: {
        action: "refund.requested",
        targetId: refund.id,
      },
    });
    expect(requestAuditCount).toBe(1);

    const approveResponse = await app.inject({
      method: "POST",
      url: `/api/ops/refunds/${refund.id}/approve`,
      headers: auth(adminToken),
      payload: { reason: "T-24 前运营快速审核通过" },
    });
    expect(approveResponse.statusCode).toBe(200);
    expect(approveResponse.json().refund.status).toBe("REFUNDING");

    const firstCallback = await app.inject({
      method: "POST",
      url: `/api/mock/refunds/${refund.id}/succeed`,
    });
    expect(firstCallback.statusCode).toBe(200);
    expect(firstCallback.json().idempotent).toBe(false);

    const secondCallback = await app.inject({
      method: "POST",
      url: `/api/mock/refunds/${refund.id}/succeed`,
    });
    expect(secondCallback.statusCode).toBe(200);
    expect(secondCallback.json().idempotent).toBe(true);

    const updatedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(updatedOrder.status).toBe("REFUNDED");
  });

  it("blocks forbidden user-visible activity copy", async () => {
    const adminToken = await loginAdmin("copy-ops");
    const restaurantId = await createRestaurant(adminToken);

    const response = await app.inject({
      method: "POST",
      url: "/api/ops/activities",
      headers: auth(adminToken),
      payload: activityPayload(restaurantId, {
        title: "周末脱单饭局",
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("forbidden words");
  });

  it("does not allow a user to read another user's order", async () => {
    const adminToken = await loginAdmin("acl-ops");
    const ownerToken = await loginUser("owner");
    const otherToken = await loginUser("other");
    await bindPhone(ownerToken, "13700137000");
    await bindPhone(otherToken, "13600136000");
    const activityId = await createOpenActivity(adminToken);
    const orderId = await createPaidOrder(ownerToken, activityId);

    const response = await app.inject({
      method: "GET",
      url: `/api/orders/${orderId}`,
      headers: auth(otherToken),
    });

    expect(response.statusCode).toBe(404);
  });

  it("unlocks order information in stages without exposing the address early", async () => {
    const adminToken = await loginAdmin("address-unlock-ops");
    const userToken = await loginUser("address-unlock-user");
    await bindPhone(userToken, "13500135120");
    const activityId = await createOpenActivity(adminToken);
    const orderId = await createPaidOrder(userToken, activityId);

    const beforeGrouping = await app.inject({
      method: "GET",
      url: `/api/orders/${orderId}`,
      headers: auth(userToken),
    });
    expect(beforeGrouping.statusCode).toBe(200);
    expect(beforeGrouping.json().order).toMatchObject({
      visibility: "basic",
      activity: { restaurantName: null, address: null },
    });

    await prisma.$transaction([
      prisma.activity.update({ where: { id: activityId }, data: { status: ActivityStatus.GROUPED } }),
      prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.GROUPED } }),
    ]);
    const afterGrouping = await app.inject({
      method: "GET",
      url: `/api/orders/${orderId}`,
      headers: auth(userToken),
    });
    expect(afterGrouping.statusCode).toBe(200);
    expect(afterGrouping.json().order).toMatchObject({
      visibility: "restaurant",
      activity: { restaurantName: scoped("梧桐小馆"), address: null },
    });

    await prisma.activity.update({
      where: { id: activityId },
      data: { startsAt: new Date(Date.now() + 23 * 60 * 60 * 1000) },
    });
    const atT24 = await app.inject({
      method: "GET",
      url: `/api/orders/${orderId}`,
      headers: auth(userToken),
    });
    expect(atT24.statusCode).toBe(200);
    expect(atT24.json().order).toMatchObject({
      visibility: "address",
      activity: { restaurantName: scoped("梧桐小馆"), address: "衡山路 100 号" },
    });
  });

  it("lets a user report only their completed order and records ops resolution", async () => {
    const adminToken = await loginAdmin("report-ops");
    const userToken = await loginUser("report-user");
    const otherToken = await loginUser("report-other");
    await bindPhone(userToken, "13500135121");
    const activityId = await createOpenActivity(adminToken);
    const orderId = await createPaidOrder(userToken, activityId);
    const early = await app.inject({ method: "POST", url: `/api/orders/${orderId}/reports`, headers: auth(userToken), payload: { type: "现场异常", content: "尚未结束" } });
    expect(early.statusCode).toBe(409);
    await prisma.activity.update({ where: { id: activityId }, data: { endsAt: new Date(Date.now() - 60 * 60 * 1000) } });
    const forbidden = await app.inject({ method: "POST", url: `/api/orders/${orderId}/reports`, headers: auth(otherToken), payload: { type: "现场异常", content: "无权提交" } });
    expect(forbidden.statusCode).toBe(404);
    const submitted = await app.inject({ method: "POST", url: `/api/orders/${orderId}/reports`, headers: auth(userToken), payload: { type: "现场异常", content: "需要运营跟进" } });
    expect(submitted.statusCode).toBe(200);
    const reportId = submitted.json().report.id;
    const list = await app.inject({ method: "GET", url: "/api/ops/reports", headers: auth(adminToken) });
    expect(list.statusCode).toBe(200);
    expect(list.json().reports.some((report: { id: string }) => report.id === reportId)).toBe(true);
    const resolved = await app.inject({ method: "POST", url: `/api/ops/reports/${reportId}/resolve`, headers: auth(adminToken), payload: { status: "RESOLVED", reason: "已处理" } });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().report.status).toBe("RESOLVED");
    expect(await prisma.auditLog.count({ where: { action: "report.resolved", targetId: reportId } })).toBe(1);
  });

  it("enforces activity status gates when creating orders", async () => {
    const adminToken = await loginAdmin("activity-gates");
    const draftActivityId = await createOpenActivity(adminToken, {
      status: "DRAFT",
    });
    const publishedActivityId = await createOpenActivity(adminToken, {
      status: "PUBLISHED",
    });
    const openActivityId = await createOpenActivity(adminToken, {
      status: "REGISTRATION_OPEN",
    });
    const canceledActivityId = await createOpenActivity(adminToken, {
      status: "PUBLISHED",
    });
    const completedActivityId = await createOpenActivity(adminToken, {
      status: "PUBLISHED",
    });
    await prisma.activity.update({
      where: { id: canceledActivityId },
      data: { status: ActivityStatus.CANCELED },
    });
    await prisma.activity.update({
      where: { id: completedActivityId },
      data: { status: ActivityStatus.COMPLETED },
    });

    await expectOrderCreateStatus(draftActivityId, "draft-user", 400);
    await expectOrderCreateStatus(canceledActivityId, "canceled-user", 400);
    await expectOrderCreateStatus(completedActivityId, "completed-user", 400);
    await expectOrderCreateStatus(publishedActivityId, "published-user", 200);
    await expectOrderCreateStatus(openActivityId, "open-user", 200);
  });

  it("rejects expired registration, duplicate active orders, and capacity overflow", async () => {
    const adminToken = await loginAdmin("capacity-ops");
    const expiredActivityId = await createOpenActivity(adminToken, {
      registrationEndsAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    await expectOrderCreateStatus(expiredActivityId, "expired-user", 409);
    await expectOrderCount(expiredActivityId, 0);

    const duplicateActivityId = await createOpenActivity(adminToken);
    const duplicateUserToken = await loginUser("duplicate-user");
    await bindPhone(duplicateUserToken, "13500135001");
    const firstOrder = await createOrder(duplicateUserToken, duplicateActivityId);
    expect(firstOrder.statusCode).toBe(200);
    const duplicateOrder = await createOrder(duplicateUserToken, duplicateActivityId);
    expect(duplicateOrder.statusCode).toBe(409);
    await expectOrderCount(duplicateActivityId, 1);

    const cappedActivityId = await createOpenActivity(adminToken, { capacity: 4 });
    for (let index = 0; index < 4; index += 1) {
      await expectOrderCreateStatus(
        cappedActivityId,
        `capacity-user-${index}`,
        200,
        `13600135${index.toString().padStart(3, "0")}`,
      );
    }
    await expectOrderCreateStatus(cappedActivityId, "capacity-user-5", 409);
    await expectOrderCount(cappedActivityId, 4);
  });

  it("rejects illegal payment callbacks without changing protected order states", async () => {
    const adminToken = await loginAdmin("payment-state-ops");

    for (const [index, status] of [
      OrderStatus.CANCELED,
      OrderStatus.REFUNDING,
      OrderStatus.REFUNDED,
    ].entries()) {
      const userToken = await loginUser(`payment-state-user-${index}`);
      await bindPhone(userToken, `1350013510${index}`);
      const activityId = await createOpenActivity(adminToken);
      const orderId = await createPendingOrder(userToken, activityId);
      const payment = await createMockPayment(userToken, orderId);
      await prisma.order.update({
        where: { id: orderId },
        data: { status },
      });

      const response = await app.inject({
        method: "POST",
        url: `/api/mock/payments/${payment.id}/succeed`,
      });

      expect(response.statusCode).toBe(409);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe(status);
      expect(order.amountCents).toBe(9900);
      const auditCount = await prisma.auditLog.count({
        where: {
          action: "payment.callback.rejected",
          targetId: payment.id,
        },
      });
      expect(auditCount).toBe(1);
    }
  });

  it("requires ops approval before refund callbacks and blocks refunded regressions", async () => {
    const adminToken = await loginAdmin("refund-state-ops");
    const userToken = await loginUser("refund-state-user");
    await bindPhone(userToken, "13500135020");
    const activityId = await createOpenActivity(adminToken);
    const orderId = await createPaidOrder(userToken, activityId);

    const cancelResponse = await app.inject({
      method: "POST",
      url: `/api/orders/${orderId}/cancel`,
      headers: auth(userToken),
      payload: { reason: "计划调整" },
    });
    expect(cancelResponse.statusCode).toBe(200);
    const refund = cancelResponse.json().refund;
    expect(refund.status).toBe("REVIEWING");

    const earlyCallback = await app.inject({
      method: "POST",
      url: `/api/mock/refunds/${refund.id}/succeed`,
    });
    expect(earlyCallback.statusCode).toBe(409);
    await expectOrderStatus(orderId, OrderStatus.REFUND_REVIEWING);

    const approveResponse = await app.inject({
      method: "POST",
      url: `/api/ops/refunds/${refund.id}/approve`,
      headers: auth(adminToken),
      payload: { reason: "T-24 前运营快速审核通过" },
    });
    expect(approveResponse.statusCode).toBe(200);
    expect(approveResponse.json().refund.status).toBe("REFUNDING");
    await expectOrderStatus(orderId, OrderStatus.REFUNDING);

    const failResponse = await app.inject({
      method: "POST",
      url: `/api/mock/refunds/${refund.id}/fail`,
      payload: { reason: "mock channel rejected" },
    });
    expect(failResponse.statusCode).toBe(200);
    expect(failResponse.json().refund.status).toBe("FAILED");
    await expectOrderStatus(orderId, OrderStatus.REFUND_REVIEWING);
    const failureAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "refund.callback.failed",
        targetId: refund.id,
      },
    });
    expect(failureAudit.reason).toBe("mock channel rejected");

    const retryApproveResponse = await app.inject({
      method: "POST",
      url: `/api/ops/refunds/${refund.id}/approve`,
      headers: auth(adminToken),
      payload: { reason: "失败后重试" },
    });
    expect(retryApproveResponse.statusCode).toBe(200);
    expect(retryApproveResponse.json().refund.status).toBe("REFUNDING");

    const successResponse = await app.inject({
      method: "POST",
      url: `/api/mock/refunds/${refund.id}/succeed`,
    });
    expect(successResponse.statusCode).toBe(200);
    expect(successResponse.json().idempotent).toBe(false);
    await expectOrderStatus(orderId, OrderStatus.REFUNDED);

    const secondSuccessResponse = await app.inject({
      method: "POST",
      url: `/api/mock/refunds/${refund.id}/succeed`,
    });
    expect(secondSuccessResponse.statusCode).toBe(200);
    expect(secondSuccessResponse.json().idempotent).toBe(true);

    const approveAfterRefunded = await app.inject({
      method: "POST",
      url: `/api/ops/refunds/${refund.id}/approve`,
      headers: auth(adminToken),
      payload: { reason: "不得回退" },
    });
    expect(approveAfterRefunded.statusCode).toBe(409);
    await expectOrderStatus(orderId, OrderStatus.REFUNDED);
  });

  it("blocks new refund callbacks after an order is already refunded", async () => {
    const adminToken = await loginAdmin("double-refund-ops");
    const userToken = await loginUser("double-refund-user");
    await bindPhone(userToken, "13500135030");
    const activityId = await createOpenActivity(adminToken);
    const orderId = await createPaidOrder(userToken, activityId);
    const refund = await cancelApproveAndRefund(adminToken, userToken, orderId);

    const secondRefund = await prisma.refund.create({
      data: {
        orderId,
        amountCents: 9900,
        reason: "重复退款探针",
        requestedBy: "ops",
        status: RefundStatus.REFUNDING,
      },
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/mock/refunds/${secondRefund.id}/succeed`,
    });
    expect(response.statusCode).toBe(409);
    await expectOrderStatus(orderId, OrderStatus.REFUNDED);
    const originalRefund = await prisma.refund.findUniqueOrThrow({
      where: { id: refund.id },
    });
    expect(originalRefund.status).toBe(RefundStatus.SUCCEEDED);
  });

  it("validates table size configuration", async () => {
    const adminToken = await loginAdmin("table-rule-ops");
    const restaurantId = await createRestaurant(adminToken);

    const tooSmall = await app.inject({
      method: "POST",
      url: "/api/ops/activities",
      headers: auth(adminToken),
      payload: activityPayload(restaurantId, { minSize: 3 }),
    });
    expect(tooSmall.statusCode).toBe(400);

    const tooLarge = await app.inject({
      method: "POST",
      url: "/api/ops/activities",
      headers: auth(adminToken),
      payload: activityPayload(restaurantId, { targetSize: 9 }),
    });
    expect(tooLarge.statusCode).toBe(400);

    const manualFourToEight = await app.inject({
      method: "POST",
      url: "/api/ops/activities",
      headers: auth(adminToken),
      payload: activityPayload(restaurantId, {
        minSize: 4,
        targetSize: 6,
        maxSize: 8,
      }),
    });
    expect(manualFourToEight.statusCode).toBe(200);
  });

  it("lets ops preview paid grouping candidates, draft tables idempotently, and confirm them", async () => {
    const adminToken = await loginAdmin("table-grouping-ops");
    const activityId = await createOpenActivity(adminToken);
    const userTokens: string[] = [];

    for (let index = 0; index < 6; index += 1) {
      const userToken = await loginUser(`table-grouping-user-${index}`);
      userTokens.push(userToken);
      await bindPhone(userToken, `13600136${String(index).padStart(3, "0")}`);
      const profileResponse = await app.inject({
        method: "PUT",
        url: "/api/profile",
        headers: auth(userToken),
        payload: profilePayload(),
      });
      expect(profileResponse.statusCode).toBe(200);
      await createPaidOrder(userToken, activityId);
    }

    const forbiddenPreview = await app.inject({
      method: "GET",
      url: `/api/ops/activities/${activityId}/table-candidates`,
      headers: auth(userTokens[0]!),
    });
    expect(forbiddenPreview.statusCode).toBe(403);

    const preview = await app.inject({
      method: "GET",
      url: `/api/ops/activities/${activityId}/table-candidates`,
      headers: auth(adminToken),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().candidates).toHaveLength(6);
    expect(preview.json().candidates[0]).toMatchObject({
      order: { status: "PAID_PENDING_GROUP" },
      profile: {
        preferredAreas: ["徐汇", "静安"],
        acceptableTableSizes: [4, 6],
      },
    });
    expect(JSON.stringify(preview.json())).not.toContain("13600136");
    expect(JSON.stringify(preview.json())).not.toContain("wechatOpenid");
    expect(JSON.stringify(preview.json())).not.toContain("靠近地铁即可");

    const draft = await app.inject({
      method: "POST",
      url: `/api/ops/activities/${activityId}/table-groups/draft`,
      headers: auth(adminToken),
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.json()).toMatchObject({
      idempotent: false,
      decision: { canForm: true, tableSizes: [6], unassignedCount: 0 },
    });
    expect(draft.json().tableGroups).toHaveLength(1);

    const repeatedDraft = await app.inject({
      method: "POST",
      url: `/api/ops/activities/${activityId}/table-groups/draft`,
      headers: auth(adminToken),
    });
    expect(repeatedDraft.statusCode).toBe(200);
    expect(repeatedDraft.json().idempotent).toBe(true);
    expect(await prisma.tableGroup.count({ where: { activityId } })).toBe(1);
    expect(await prisma.tableMember.count({ where: { tableGroup: { activityId } } })).toBe(6);
    await expectActivityStatus(activityId, ActivityStatus.LOCKING);

    const confirmed = await app.inject({
      method: "POST",
      url: `/api/ops/activities/${activityId}/table-groups/confirm`,
      headers: auth(adminToken),
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ idempotent: false, activityStatus: "GROUPED", notificationQueued: true });
    await expectActivityStatus(activityId, ActivityStatus.GROUPED);
    expect(await prisma.order.count({ where: { activityId, status: OrderStatus.GROUPED } })).toBe(6);
    expect(await prisma.tableGroup.count({ where: { activityId, status: "CONFIRMED" } })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { action: "table-groups.confirmed", targetId: activityId },
    })).toBe(1);
    expect(await prisma.notification.count({
      where: { type: "GROUP_CONFIRMED", status: "SENT", user: { orders: { some: { activityId } } } },
    })).toBe(6);
    const inbox = await app.inject({ method: "GET", url: "/api/notifications", headers: auth(userTokens[0]!) });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json().notifications).toHaveLength(1);
    expect(inbox.json().notifications[0]).toMatchObject({ type: "GROUP_CONFIRMED", status: "SENT", payload: { title: "饭局已成团" } });
  });

  it("lets ops manually rearrange a locking table draft without adding or dropping paid orders", async () => {
    const adminToken = await loginAdmin("table-grouping-adjust-ops");
    const activityId = await createOpenActivity(adminToken, { targetSize: 8, maxSize: 8 });
    const orderIds: string[] = [];

    for (let index = 0; index < 8; index += 1) {
      const userToken = await loginUser(`table-grouping-adjust-user-${index}`);
      await bindPhone(userToken, `13600137${String(index).padStart(3, "0")}`);
      orderIds.push(await createPaidOrder(userToken, activityId));
    }

    const draft = await app.inject({
      method: "POST",
      url: `/api/ops/activities/${activityId}/table-groups/draft`,
      headers: auth(adminToken),
    });
    expect(draft.statusCode).toBe(200);

    const adjusted = await app.inject({
      method: "PUT",
      url: `/api/ops/activities/${activityId}/table-groups`,
      headers: auth(adminToken),
      payload: { tableGroups: [{ orderIds: orderIds.slice(0, 4) }, { orderIds: orderIds.slice(4) }] },
    });
    expect(adjusted.statusCode).toBe(200);
    expect(adjusted.json().tableGroups.map((group: { orderIds: string[] }) => group.orderIds)).toEqual([
      orderIds.slice(0, 4),
      orderIds.slice(4),
    ]);
    expect(await prisma.tableGroup.count({ where: { activityId, status: "PENDING_CONFIRMATION" } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "table-groups.adjusted", targetId: activityId } })).toBe(1);

    const reopened = await app.inject({
      method: "GET",
      url: `/api/ops/activities/${activityId}/table-candidates`,
      headers: auth(adminToken),
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().tableGroups.map((group: { orderIds: string[] }) => group.orderIds)).toEqual([
      orderIds.slice(0, 4),
      orderIds.slice(4),
    ]);

    const dropsAnOrder = await app.inject({
      method: "PUT",
      url: `/api/ops/activities/${activityId}/table-groups`,
      headers: auth(adminToken),
      payload: { tableGroups: [{ orderIds: orderIds.slice(0, 4) }] },
    });
    expect(dropsAnOrder.statusCode).toBe(400);
  });

  it("rejects a grouping draft when fewer than four paid orders are eligible", async () => {
    const adminToken = await loginAdmin("table-grouping-minimum-ops");
    const activityId = await createOpenActivity(adminToken);

    for (let index = 0; index < 3; index += 1) {
      const userToken = await loginUser(`table-grouping-minimum-user-${index}`);
      await bindPhone(userToken, `13700137${String(index).padStart(3, "0")}`);
      await createPaidOrder(userToken, activityId);
    }

    const draft = await app.inject({
      method: "POST",
      url: `/api/ops/activities/${activityId}/table-groups/draft`,
      headers: auth(adminToken),
    });
    expect(draft.statusCode).toBe(409);
    expect(draft.json()).toMatchObject({
      error: "Not enough paid orders to form valid tables",
      decision: { canForm: false, reason: "below_minimum", unassignedCount: 3 },
    });
    expect(await prisma.tableGroup.count({ where: { activityId } })).toBe(0);
    await expectActivityStatus(activityId, ActivityStatus.REGISTRATION_OPEN);
  });

  it("lets ops mark an undersized activity as group failed after registration closes without creating refunds", async () => {
    const adminToken = await loginAdmin("group-failure-ops");
    const activityId = await createOpenActivity(adminToken);
    const orderIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const userToken = await loginUser(`group-failure-user-${index}`);
      await bindPhone(userToken, `13700138${String(index).padStart(3, "0")}`);
      orderIds.push(await createPaidOrder(userToken, activityId));
    }
    await prisma.activity.update({
      where: { id: activityId },
      data: { registrationEndsAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const forbidden = await app.inject({
      method: "POST",
      url: `/api/ops/activities/${activityId}/mark-group-failed`,
      headers: auth(await loginUser("group-failure-forbidden")),
      payload: { reason: "报名截止后人数不足" },
    });
    expect(forbidden.statusCode).toBe(403);

    const marked = await app.inject({
      method: "POST",
      url: `/api/ops/activities/${activityId}/mark-group-failed`,
      headers: auth(adminToken),
      payload: { reason: "报名截止后人数不足" },
    });
    expect(marked.statusCode).toBe(200);
    expect(marked.json()).toMatchObject({ idempotent: false, activityStatus: "GROUP_FAILED", affectedOrderCount: 3, notificationQueued: true });
    await expectActivityStatus(activityId, ActivityStatus.GROUP_FAILED);
    expect(await prisma.order.count({ where: { id: { in: orderIds }, status: OrderStatus.GROUP_FAILED } })).toBe(3);
    expect(await prisma.refund.count({ where: { orderId: { in: orderIds } } })).toBe(0);
    expect(await prisma.notification.count({
      where: { type: "GROUP_FAILED", status: "SENT", user: { orders: { some: { id: { in: orderIds } } } } },
    })).toBe(3);
    expect(await prisma.auditLog.findFirst({ where: { action: "activity.group_failed", targetId: activityId, reason: "报名截止后人数不足" } })).not.toBeNull();

    const repeated = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/mark-group-failed`, headers: auth(adminToken), payload: { reason: "重复请求" } });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().idempotent).toBe(true);
  });

  it("lets ops add a blacklist entry, blocks new registration, and requires super admin to remove it", async () => {
    const opsToken = await loginAdmin("blacklist-ops");
    const superAdminToken = await loginAdmin("blacklist-super", "SUPER_ADMIN");
    const userToken = await loginUser("blacklist-user");
    await bindPhone(userToken, "13500135090");
    const userId = userTokenPayload(userToken).sub;
    const activityId = await createOpenActivity(opsToken);

    const added = await app.inject({
      method: "POST",
      url: "/api/ops/blacklist",
      headers: auth(opsToken),
      payload: { userId, reason: "多次扰乱活动秩序" },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json().idempotent).toBe(false);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({ status: "BLACKLISTED" });

    const registration = await createOrder(userToken, activityId);
    expect(registration.statusCode).toBe(403);
    expect(registration.json().error).toBe("User cannot register");
    const listed = await app.inject({ method: "GET", url: "/api/ops/blacklist", headers: auth(opsToken) });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().entries).toEqual(expect.arrayContaining([expect.objectContaining({ userId, reason: "多次扰乱活动秩序" })]));

    const forbiddenRemove = await app.inject({ method: "DELETE", url: `/api/ops/blacklist/${userId}`, headers: auth(opsToken), payload: { reason: "无权解除" } });
    expect(forbiddenRemove.statusCode).toBe(403);
    const removed = await app.inject({ method: "DELETE", url: `/api/ops/blacklist/${userId}`, headers: auth(superAdminToken), payload: { reason: "复核后解除" } });
    expect(removed.statusCode).toBe(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({ status: "NORMAL" });
    expect(await prisma.auditLog.count({ where: { targetId: userId, action: { in: ["blacklist.added", "blacklist.removed"] } } })).toBe(2);
  });

  it("lets an order owner create or update a completed-order review and rejects other order states", async () => {
    const adminToken = await loginAdmin("review-ops");
    const ownerToken = await loginUser("review-owner");
    const otherUserToken = await loginUser("review-other-user");
    await bindPhone(ownerToken, "13500135091");
    await bindPhone(otherUserToken, "13500135092");
    const completedOrderId = await createPaidOrder(ownerToken, await createOpenActivity(adminToken));
    await prisma.order.update({ where: { id: completedOrderId }, data: { status: OrderStatus.COMPLETED } });

    const created = await app.inject({
      method: "PUT",
      url: `/api/orders/${completedOrderId}/review`,
      headers: auth(ownerToken),
      payload: { score: 5, tags: ["餐厅氛围", "组织顺畅"], content: "体验不错" },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().review).toMatchObject({ score: 5, tags: ["餐厅氛围", "组织顺畅"], content: "体验不错" });

    const updated = await app.inject({
      method: "PUT",
      url: `/api/orders/${completedOrderId}/review`,
      headers: auth(ownerToken),
      payload: { score: 4, tags: ["菜品"], content: "已更新" },
    });
    expect(updated.statusCode).toBe(200);
    expect(await prisma.review.count({ where: { orderId: completedOrderId } })).toBe(1);
    expect(await prisma.review.findUniqueOrThrow({ where: { orderId: completedOrderId } })).toMatchObject({ score: 4, tags: ["菜品"], content: "已更新" });

    const forbidden = await app.inject({ method: "PUT", url: `/api/orders/${completedOrderId}/review`, headers: auth(otherUserToken), payload: { score: 5, tags: [], content: "越权" } });
    expect(forbidden.statusCode).toBe(404);
    const pendingOrderId = await createPendingOrder(ownerToken, await createOpenActivity(adminToken));
    const pending = await app.inject({ method: "PUT", url: `/api/orders/${pendingOrderId}/review`, headers: auth(ownerToken), payload: { score: 5, tags: [], content: "尚未结束" } });
    expect(pending.statusCode).toBe(409);
    const canceledOrderId = await createPendingOrder(ownerToken, await createOpenActivity(adminToken));
    await prisma.order.update({ where: { id: canceledOrderId }, data: { status: OrderStatus.CANCELED } });
    const canceled = await app.inject({ method: "PUT", url: `/api/orders/${canceledOrderId}/review`, headers: auth(ownerToken), payload: { score: 5, tags: [], content: "已取消" } });
    expect(canceled.statusCode).toBe(409);
    const refundedOrderId = await createPendingOrder(ownerToken, await createOpenActivity(adminToken));
    await prisma.order.update({ where: { id: refundedOrderId }, data: { status: OrderStatus.REFUNDED } });
    const refunded = await app.inject({ method: "PUT", url: `/api/orders/${refundedOrderId}/review`, headers: auth(ownerToken), payload: { score: 5, tags: [], content: "已退款" } });
    expect(refunded.statusCode).toBe(409);

    const opsList = await app.inject({ method: "GET", url: "/api/ops/reviews", headers: auth(adminToken) });
    expect(opsList.statusCode).toBe(200);
    expect(opsList.json().reviews).toEqual(expect.arrayContaining([expect.objectContaining({ order: expect.objectContaining({ id: completedOrderId }), score: 4 })]));
  });

  it("lets ops manually start and complete a past grouped activity, then unlocks the review path", async () => {
    const opsToken = await loginAdmin("activity-completion-ops");
    const userToken = await loginUser("activity-completion-user");
    await bindPhone(userToken, "13500135093");
    const activityId = await createOpenActivity(opsToken);
    const orderId = await createPaidOrder(userToken, activityId);
    await prisma.activity.update({
      where: { id: activityId },
      data: { status: ActivityStatus.GROUPED, startsAt: new Date(Date.now() - 2 * 60 * 60 * 1000), endsAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    await prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.GROUPED } });

    const userStart = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/start`, headers: auth(userToken) });
    expect(userStart.statusCode).toBe(403);
    const started = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/start`, headers: auth(opsToken) });
    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({ idempotent: false, activityStatus: "IN_PROGRESS" });
    const completed = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/complete`, headers: auth(opsToken) });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ idempotent: false, activityStatus: "COMPLETED", completedOrderCount: 1 });
    await expectActivityStatus(activityId, ActivityStatus.COMPLETED);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ status: OrderStatus.COMPLETED });
    expect(await prisma.auditLog.count({ where: { targetId: activityId, action: { in: ["activity.started", "activity.completed"] } } })).toBe(2);
    const review = await app.inject({ method: "PUT", url: `/api/orders/${orderId}/review`, headers: auth(userToken), payload: { score: 5, tags: ["完成"], content: "可以评价" } });
    expect(review.statusCode).toBe(200);
  });

  it("serves minimal ops list endpoints for restaurants, activities, orders, refunds, and audits", async () => {
    const adminToken = await loginAdmin("ops-list-ops");
    const userToken = await loginUser("ops-list-user");
    await bindPhone(userToken, "13500135040");
    const activityId = await createOpenActivity(adminToken);
    const orderId = await createPaidOrder(userToken, activityId);
    const cancelResponse = await app.inject({
      method: "POST",
      url: `/api/orders/${orderId}/cancel`,
      headers: auth(userToken),
      payload: { reason: "列表联调取消" },
    });
    expect(cancelResponse.statusCode).toBe(200);

    for (const [url, key] of [
      ["/api/ops/restaurants", "restaurants"],
      ["/api/ops/activities", "activities"],
      ["/api/ops/orders", "orders"],
      ["/api/ops/refunds", "refunds"],
      ["/api/ops/audit-logs", "auditLogs"],
    ] as const) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: auth(adminToken),
      });
      expect(response.statusCode).toBe(200);
      expect(Array.isArray(response.json()[key])).toBe(true);
      expect(response.json()[key].length).toBeGreaterThan(0);
    }
  });
});

async function cleanupTestData(): Promise<void> {
  const [users, admins, restaurants] = await Promise.all([
    prisma.user.findMany({
      where: { wechatOpenid: { startsWith: `mock_openid_${testRunPrefix}_` } },
      select: { id: true },
    }),
    prisma.adminUser.findMany({
      where: { username: { startsWith: `${testRunPrefix}_` } },
      select: { id: true },
    }),
    prisma.restaurant.findMany({
      where: { name: { startsWith: `${testRunPrefix}_` } },
      select: { id: true },
    }),
  ]);
  const userIds = users.map((user) => user.id);
  const adminIds = admins.map((admin) => admin.id);
  const restaurantIds = restaurants.map((restaurant) => restaurant.id);
  const activities = await prisma.activity.findMany({
    where: {
      OR: [
        { restaurantId: { in: restaurantIds } },
        { title: { startsWith: `${testRunPrefix}_` } },
      ],
    },
    select: { id: true },
  });
  const activityIds = activities.map((activity) => activity.id);
  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { activityId: { in: activityIds } },
      ],
    },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);
  const [payments, refunds, tableGroups] = await Promise.all([
    prisma.payment.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    }),
    prisma.refund.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    }),
    prisma.tableGroup.findMany({
      where: { activityId: { in: activityIds } },
      select: { id: true },
    }),
  ]);
  const paymentIds = payments.map((payment) => payment.id);
  const refundIds = refunds.map((refund) => refund.id);
  const tableGroupIds = tableGroups.map((group) => group.id);
  const targetIds = [
    ...orderIds,
    ...paymentIds,
    ...refundIds,
    ...activityIds,
    ...restaurantIds,
    ...tableGroupIds,
  ];

  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorId: { in: [...userIds, ...adminIds] } },
        { targetId: { in: targetIds } },
      ],
    },
  });
  await prisma.blacklist.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.review.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { orderId: { in: orderIds } }] } });
  await prisma.report.deleteMany({
    where: {
      OR: [{ userId: { in: userIds } }, { orderId: { in: orderIds } }],
    },
  });
  await prisma.tableMember.deleteMany({
    where: {
      OR: [
        { tableGroupId: { in: tableGroupIds } },
        { orderId: { in: orderIds } },
      ],
    },
  });
  await prisma.tableGroup.deleteMany({ where: { id: { in: tableGroupIds } } });
  await prisma.refund.deleteMany({ where: { id: { in: refundIds } } });
  await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.activity.deleteMany({ where: { id: { in: activityIds } } });
  await prisma.restaurant.deleteMany({ where: { id: { in: restaurantIds } } });
  await prisma.consentRecord.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
}

async function loginAdmin(username: string, role: "OPS" | "SUPER_ADMIN" = "OPS"): Promise<string> {
  const response = await appInject({
    method: "POST",
    url: "/api/mock/admin-login",
    payload: { username: scoped(username), role },
  });
  expect(response.statusCode).toBe(200);
  return response.json().token;
}

function userTokenPayload(token: string): { sub: string } {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Invalid user token");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub: string };
}

async function loginUser(code: string): Promise<string> {
  const response = await appInject({
    method: "POST",
    url: "/api/mock/wechat-login",
    payload: { code: scoped(code) },
  });
  expect(response.statusCode).toBe(200);
  return response.json().token;
}

async function bindPhone(token: string, phone: string): Promise<void> {
  const response = await appInject({
    method: "POST",
    url: "/api/mock/phone",
    headers: auth(token),
    payload: { phone },
  });
  expect(response.statusCode).toBe(200);
}

async function createRestaurant(adminToken: string): Promise<string> {
  const response = await appInject({
    method: "POST",
    url: "/api/ops/restaurants",
    headers: auth(adminToken),
    payload: {
      name: scoped("梧桐小馆"),
      district: "徐汇",
      businessArea: "衡山路",
      address: "衡山路 100 号",
      contactName: "运营联系人",
      contactPhone: "13500135000",
      budgetCents: 18800,
      cuisineTags: ["本帮菜"],
      capacity: 12,
    },
  });
  expect(response.statusCode).toBe(200);
  return response.json().restaurant.id;
}

async function createOpenActivity(
  adminToken: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const restaurantId = await createRestaurant(adminToken);
  const response = await appInject({
    method: "POST",
    url: "/api/ops/activities",
    headers: auth(adminToken),
    payload: activityPayload(restaurantId, overrides),
  });
  expect(response.statusCode).toBe(200);
  return response.json().activity.id;
}

async function createOrder(userToken: string, activityId: string) {
  await confirmAgreement(userToken);
  return appInject({
    method: "POST",
    url: "/api/orders",
    headers: auth(userToken),
    payload: {
      activityId,
      agreementVersion: "v1",
      amountCents: 1,
    },
  });
}

async function confirmAgreement(token: string, agreementVersion = "v1"): Promise<void> {
  const response = await appInject({
    method: "POST",
    url: "/api/consents",
    headers: auth(token),
    payload: { agreementVersion, source: "test" },
  });
  expect(response.statusCode).toBe(200);
}

async function createPendingOrder(userToken: string, activityId: string): Promise<string> {
  const orderResponse = await createOrder(userToken, activityId);
  expect(orderResponse.statusCode).toBe(200);
  return orderResponse.json().order.id;
}

async function createPaidOrder(userToken: string, activityId: string): Promise<string> {
  const orderId = await createPendingOrder(userToken, activityId);
  const payment = await createMockPayment(userToken, orderId);
  const callbackResponse = await appInject({
    method: "POST",
    url: `/api/mock/payments/${payment.id}/succeed`,
  });
  expect(callbackResponse.statusCode).toBe(200);
  return orderId;
}

async function createMockPayment(userToken: string, orderId: string) {
  const paymentResponse = await appInject({
    method: "POST",
    url: "/api/mock/payments",
    headers: auth(userToken),
    payload: { orderId },
  });
  expect(paymentResponse.statusCode).toBe(200);
  return paymentResponse.json().payment;
}

async function expectOrderCreateStatus(
  activityId: string,
  code: string,
  statusCode: number,
  phone = "13500135000",
): Promise<void> {
  const userToken = await loginUser(code);
  await bindPhone(userToken, phone);
  const response = await createOrder(userToken, activityId);
  expect(response.statusCode).toBe(statusCode);
  if (statusCode === 200) {
    expect(response.json().order.amountCents).toBe(9900);
  }
}

async function expectOrderCount(activityId: string, expectedCount: number): Promise<void> {
  const count = await prisma.order.count({ where: { activityId } });
  expect(count).toBe(expectedCount);
}

async function expectOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  expect(order.status).toBe(status);
}

async function expectActivityStatus(activityId: string, status: ActivityStatus): Promise<void> {
  const activity = await prisma.activity.findUniqueOrThrow({ where: { id: activityId } });
  expect(activity.status).toBe(status);
}

async function cancelApproveAndRefund(
  adminToken: string,
  userToken: string,
  orderId: string,
) {
  const cancelResponse = await appInject({
    method: "POST",
    url: `/api/orders/${orderId}/cancel`,
    headers: auth(userToken),
    payload: { reason: "取消后退款" },
  });
  expect(cancelResponse.statusCode).toBe(200);
  const refund = cancelResponse.json().refund;
  const approveResponse = await appInject({
    method: "POST",
    url: `/api/ops/refunds/${refund.id}/approve`,
    headers: auth(adminToken),
    payload: { reason: "运营快速审核通过" },
  });
  expect(approveResponse.statusCode).toBe(200);
  const successResponse = await appInject({
    method: "POST",
    url: `/api/mock/refunds/${refund.id}/succeed`,
  });
  expect(successResponse.statusCode).toBe(200);
  return refund;
}

function activityPayload(
  restaurantId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const startsAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
  const registrationEndsAt = new Date(startsAt.getTime() - 24 * 60 * 60 * 1000);

  return {
    restaurantId,
    title: scoped("周末兴趣餐桌"),
    theme: "本帮菜体验",
    description: "两小时餐厅体验，费用为服务费/订位费，餐费到店自理。",
    district: "徐汇",
    businessArea: "衡山路",
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    registrationEndsAt: registrationEndsAt.toISOString(),
    serviceFeeCents: 9900,
    mealFeeIncluded: false,
    mealFeePolicyText: "票价仅为服务费/订位费，不包含全部餐费。",
    capacity: 12,
    status: "REGISTRATION_OPEN",
    ...overrides,
  };
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function profilePayload() {
  return {
    preferredAreas: ["徐汇", "静安"],
    availableTimes: ["周六晚"],
    tastePreferences: ["本帮菜"],
    dietaryRestrictions: ["无"],
    budgetRange: "150-250",
    tableVibe: "轻松聊天",
    acceptableTableSizes: [4, 6],
    note: "靠近地铁即可",
  };
}

function wechatCallbackEnv() {
  return {
    PAYMENT_PROVIDER: "wechat",
    REFUND_PROVIDER: "wechat",
    FEATURE_REAL_WECHAT_PAY: "true",
    WECHAT_PAY_ENABLED: "true",
    WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
    WECHAT_PAY_MCH_ID: "test_mch_id",
    WECHAT_PAY_API_V3_KEY: "test_api_v3_key",
    WECHAT_PAY_PRIVATE_KEY_PATH: "/tmp/test-key.pem",
    WECHAT_PAY_CERT_SERIAL_NO: "test_cert_serial",
    WECHAT_PAY_PLATFORM_CERT_PATH: "/tmp/test-platform-cert.pem",
    WECHAT_PAY_CALLBACK_URL: "https://example.invalid/pay",
    WECHAT_REFUND_CALLBACK_URL: "https://example.invalid/refund",
  };
}

function signedWechatCallback(resource: Record<string, unknown>) {
  const nonce = randomBytes(12).toString("base64url").slice(0, 12);
  const associatedData = "transaction";
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(callbackFixtureKey), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(resource), "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
  const body = JSON.stringify({ resource: { associated_data: associatedData, nonce, ciphertext } });
  const signer = createSign("RSA-SHA256");
  signer.update(`${callbackNowSeconds}\ncallback-notification-nonce\n${body}\n`);
  signer.end();
  return {
    body,
    headers: {
      "content-type": "application/json",
      "wechatpay-timestamp": String(callbackNowSeconds),
      "wechatpay-nonce": "callback-notification-nonce",
      "wechatpay-signature": signer.sign(callbackPrivateKey, "base64"),
    },
  };
}

function scoped(value: string): string {
  return `${testRunPrefix}_${value}`;
}

let appRef: Awaited<ReturnType<typeof buildApp>>;

async function appInject(options: Parameters<typeof appRef.inject>[0]) {
  return appRef.inject(options);
}
