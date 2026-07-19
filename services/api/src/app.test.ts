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

  it("validates table size configuration without adding grouping endpoints", async () => {
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

async function loginAdmin(username: string): Promise<string> {
  const response = await appInject({
    method: "POST",
    url: "/api/mock/admin-login",
    payload: { username: scoped(username), role: "OPS" },
  });
  expect(response.statusCode).toBe(200);
  return response.json().token;
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

function wechatCallbackEnv() {
  return {
    PAYMENT_PROVIDER: "wechat",
    REFUND_PROVIDER: "wechat",
    FEATURE_REAL_WECHAT_PAY: "true",
    WECHAT_PAY_ENABLED: "true",
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
