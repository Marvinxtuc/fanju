import cors from "@fastify/cors";
import {
  ActivityStatus,
  OrderStatus,
  PaymentStatus,
  RefundStatus,
  type PrismaClient,
} from "./generated/prisma/client.js";
import {
  assertVisibleCopyAllowed,
  calculateOrderAmountCents,
} from "@timeleft-shanghai/shared";
import Fastify from "fastify";
import { z, ZodError } from "zod";
import { registerAuth, requireOps, requireUser } from "./auth.js";
import { prisma as defaultPrisma } from "./prisma.js";
import {
  createWechatProviders,
  ProviderConfigError,
  type ProviderHttpClient,
  ProviderUnavailableError,
  type ProviderEnv,
} from "./providers.js";

const phoneSchema = z.string().regex(/^\+?\d{8,15}$/);

export interface BuildAppOptions {
  prisma?: PrismaClient;
  providerEnv?: ProviderEnv;
  providerHttpClient?: ProviderHttpClient;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const db = options.prisma ?? defaultPrisma;
  const providers = createWechatProviders(options.providerEnv, {
    ...(options.providerHttpClient === undefined
      ? {}
      : { httpClient: options.providerHttpClient }),
  });
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await registerAuth(app);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "Validation failed",
        issues: error.issues,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("forbidden words") ||
      message.includes("mealFeeIncluded")
    ) {
      return reply.code(400).send({ error: message });
    }
    if (error instanceof ProviderUnavailableError) {
      return reply.code(503).send({ error: message });
    }
    if (error instanceof ProviderConfigError) {
      return reply.code(500).send({ error: message });
    }
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (
      typeof statusCode === "number" &&
      statusCode >= 400 &&
      statusCode < 500
    ) {
      return reply
        .code(statusCode)
        .send({ error: statusCode === 401 ? "Unauthorized" : message });
    }

    app.log.error(error);
    return reply.code(500).send({ error: "Internal server error" });
  });

  app.get("/health", async () => ({ ok: true }));

  app.post("/api/mock/wechat-login", async (request) => {
    const body = z.object({ code: z.string().min(1) }).parse(request.body);
    const identity = await providers.auth.exchangeLoginCode({ code: body.code });
    const user = await db.user.upsert({
      where: { wechatOpenid: identity.openid },
      update:
        identity.unionid === undefined
          ? {}
          : { wechatUnionid: identity.unionid },
      create: {
        wechatOpenid: identity.openid,
        ...(identity.unionid === undefined
          ? {}
          : { wechatUnionid: identity.unionid }),
      },
    });
    const token = app.jwt.sign({ sub: user.id, role: "USER" });

    return {
      token,
      user: {
        id: user.id,
        phone: maskPhone(user.phone),
        status: user.status,
      },
    };
  });

  app.post("/api/mock/phone", async (request) => {
    const auth = await requireUser(request);
    const body = z
      .object({
        phone: phoneSchema.optional(),
        code: z.string().min(1).optional(),
      })
      .parse(request.body);
    const resolved = await providers.phone.resolvePhone({
      ...(body.phone === undefined ? {} : { phone: body.phone }),
      ...(body.code === undefined ? {} : { code: body.code }),
    });
    const user = await db.user.update({
      where: { id: auth.sub },
      data: { phone: resolved.phone },
    });

    return { user: { id: user.id, phone: maskPhone(user.phone) } };
  });

  app.post("/api/mock/admin-login", async (request) => {
    const body = z
      .object({
        username: z.string().min(2),
        role: z.enum(["OPS", "SUPER_ADMIN"]).default("OPS"),
      })
      .parse(request.body);
    const admin = await db.adminUser.upsert({
      where: { username: body.username },
      update: { role: body.role },
      create: { username: body.username, role: body.role },
    });
    const token = app.jwt.sign({ sub: admin.id, role: admin.role });

    return { token, admin: { id: admin.id, username: admin.username, role: admin.role } };
  });

  app.get("/api/activities", async () => {
    const activities = await db.activity.findMany({
      where: { status: { in: [ActivityStatus.PUBLISHED, ActivityStatus.REGISTRATION_OPEN] } },
      orderBy: { startsAt: "asc" },
      select: publicActivitySelect,
    });

    return { activities };
  });

  app.get("/api/activities/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const activity = await db.activity.findUnique({
      where: { id: params.id },
      select: publicActivitySelect,
    });
    if (!activity) {
      return reply.code(404).send({ error: "Activity not found" });
    }

    return { activity };
  });

  app.post("/api/ops/restaurants", async (request) => {
    await requireOps(request);
    const body = restaurantInputSchema.parse(request.body);
    const restaurant = await db.restaurant.create({ data: body });

    return { restaurant };
  });

  app.get("/api/ops/restaurants", async (request) => {
    await requireOps(request);
    const restaurants = await db.restaurant.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return { restaurants };
  });

  app.post("/api/ops/activities", async (request) => {
    await requireOps(request);
    const body = activityInputSchema.parse(request.body);
    assertVisibleCopyAllowed(`${body.title} ${body.theme} ${body.description}`);
    if (body.mealFeeIncluded !== false) {
      throw new Error("mealFeeIncluded must be false for MVP service-fee pricing");
    }

    const activity = await db.activity.create({
      data: {
        ...body,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        registrationEndsAt: new Date(body.registrationEndsAt),
      },
    });

    return { activity };
  });

  app.get("/api/ops/activities", async (request) => {
    await requireOps(request);
    const activities = await db.activity.findMany({
      orderBy: { startsAt: "asc" },
      take: 50,
      include: { restaurant: true },
    });

    return { activities };
  });

  app.get("/api/ops/orders", async (request) => {
    await requireOps(request);
    const orders = await db.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        activity: true,
        user: true,
      },
    });

    return {
      orders: orders.map((order) => ({
        id: order.id,
        amountCents: order.amountCents,
        status: order.status,
        createdAt: order.createdAt,
        activity: {
          id: order.activity.id,
          title: order.activity.title,
          startsAt: order.activity.startsAt,
        },
        user: {
          id: order.user.id,
          phone: maskPhone(order.user.phone),
          status: order.user.status,
        },
      })),
    };
  });

  app.get("/api/ops/refunds", async (request) => {
    await requireOps(request);
    const refunds = await db.refund.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { order: { include: { activity: true, user: true } } },
    });

    return {
      refunds: refunds.map((refund) => ({
        id: refund.id,
        amountCents: refund.amountCents,
        status: refund.status,
        reason: refund.reason,
        requestedBy: refund.requestedBy,
        createdAt: refund.createdAt,
        order: {
          id: refund.order.id,
          status: refund.order.status,
          activityTitle: refund.order.activity.title,
          userPhone: maskPhone(refund.order.user.phone),
        },
      })),
    };
  });

  app.get("/api/ops/audit-logs", async (request) => {
    await requireOps(request);
    const auditLogs = await db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return { auditLogs };
  });

  app.post("/api/orders", async (request, reply) => {
    const auth = await requireUser(request);
    const body = z
      .object({
        activityId: z.string(),
        agreementVersion: z.string().min(1),
      })
      .passthrough()
      .parse(request.body);
    const user = await db.user.findUnique({ where: { id: auth.sub } });

    if (!user || !user.phone) {
      return reply.code(400).send({ error: "Phone binding required" });
    }
    if (user.status === "BLACKLISTED") {
      return reply.code(403).send({ error: "User cannot register" });
    }

    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${body.activityId} FOR UPDATE`;
      const activity = await tx.activity.findUnique({ where: { id: body.activityId } });
      if (!activity || !canCreateOrder(activity.status)) {
        return { error: "Activity is not open for registration", statusCode: 400 as const };
      }
      if (Date.now() >= activity.registrationEndsAt.getTime()) {
        return { error: "Registration has ended", statusCode: 409 as const };
      }

      const existingOrder = await tx.order.findUnique({
        where: { userId_activityId: { userId: auth.sub, activityId: body.activityId } },
      });
      if (existingOrder) {
        return { error: "User already registered for this activity", statusCode: 409 as const };
      }

      const activeOrderCount = await tx.order.count({
        where: {
          activityId: activity.id,
          status: { in: CAPACITY_HOLD_ORDER_STATUSES },
        },
      });
      if (activeOrderCount >= activity.capacity) {
        return { error: "Activity capacity is full", statusCode: 409 as const };
      }

      const order = await tx.order.create({
        data: {
          userId: auth.sub,
          activityId: activity.id,
          amountCents: calculateOrderAmountCents({
            serviceFeeCents: activity.serviceFeeCents,
          }),
          agreementVersion: body.agreementVersion,
          inventoryLockedUntil: new Date(Date.now() + 15 * 60 * 1000),
        },
      });
      await tx.auditLog.create({
        data: {
          action: "order.create",
          targetType: "Order",
          targetId: order.id,
          metadata: {
            activityId: activity.id,
            status: order.status,
            amountCents: order.amountCents,
          },
        },
      });
      return { order };
    });

    if ("error" in result && typeof result.statusCode === "number") {
      return reply.code(result.statusCode).send({ error: result.error });
    }

    return { order: result.order, reused: false };
  });

  app.get("/api/orders/:id", async (request, reply) => {
    const auth = await requireUser(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const order = await db.order.findUnique({
      where: { id: params.id },
      include: { activity: { include: { restaurant: true } } },
    });
    if (!order || order.userId !== auth.sub) {
      return reply.code(404).send({ error: "Order not found" });
    }

    const visibility = getOrderVisibility(order.status, order.activity.status, order.activity.startsAt);

    return {
      order: {
        id: order.id,
        amountCents: order.amountCents,
        status: order.status,
        visibility,
        activity: {
          id: order.activity.id,
          title: order.activity.title,
          theme: order.activity.theme,
          district: order.activity.district,
          businessArea: order.activity.businessArea,
          startsAt: order.activity.startsAt,
          restaurantName:
            visibility === "restaurant" || visibility === "address"
              ? order.activity.restaurant.name
              : null,
          address: visibility === "address" ? order.activity.restaurant.address : null,
        },
      },
    };
  });

  app.post("/api/orders/:id/cancel", async (request, reply) => {
    const auth = await requireUser(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ reason: z.string().min(1).max(200) }).parse(request.body);
    const order = await db.order.findUnique({
      where: { id: params.id },
      include: { activity: true },
    });
    if (!order || order.userId !== auth.sub) {
      return reply.code(404).send({ error: "Order not found" });
    }
    if (!canRequestCancel(order.status)) {
      return reply.code(400).send({ error: "Order cannot be canceled" });
    }

    const refund = await db.$transaction(async (tx) => {
      const createdRefund = await tx.refund.create({
        data: {
          orderId: order.id,
          amountCents: order.amountCents,
          reason: body.reason,
          requestedBy: "user",
          status: RefundStatus.REVIEWING,
        },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.REFUND_REVIEWING },
      });
      await tx.auditLog.create({
        data: {
          action: "refund.requested",
          targetType: "Refund",
          targetId: createdRefund.id,
          reason: body.reason,
          metadata: {
            orderId: order.id,
            userId: auth.sub,
            fromOrderStatus: order.status,
            toOrderStatus: OrderStatus.REFUND_REVIEWING,
          },
        },
      });
      return createdRefund;
    });

    return { refund };
  });

  app.post("/api/mock/payments", async (request, reply) => {
    const auth = await requireUser(request);
    const body = z.object({ orderId: z.string() }).passthrough().parse(request.body);
    const order = await db.order.findUnique({ where: { id: body.orderId } });
    if (!order || order.userId !== auth.sub) {
      return reply.code(404).send({ error: "Order not found" });
    }
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      return reply.code(400).send({ error: "Order is not pending payment" });
    }

    const providerPayment = await providers.payment.createPayment({
      orderId: order.id,
      amountCents: order.amountCents,
    });
    const payment = await db.payment.create({
      data: {
        orderId: order.id,
        amountCents: order.amountCents,
        channel: providerPayment.channel,
      },
    });

    return { payment };
  });

  app.post("/api/mock/payments/:paymentId/succeed", async (request, reply) => {
    const params = z.object({ paymentId: z.string() }).parse(request.params);
    const payment = await db.payment.findUnique({
      where: { id: params.paymentId },
      include: { order: true },
    });
    if (!payment) {
      return reply.code(404).send({ error: "Payment not found" });
    }
    const paymentDecision = canApplyPaymentSuccess(payment.status, payment.order.status);
    if (paymentDecision === "idempotent") {
      return { payment, idempotent: true };
    }
    if (paymentDecision === "reject" && payment.status !== PaymentStatus.PENDING) {
      return reply.code(409).send({ error: "Payment is not pending" });
    }
    if (paymentDecision === "reject") {
      await db.auditLog.create({
        data: {
          action: "payment.callback.rejected",
          targetType: "Payment",
          targetId: payment.id,
          reason: "Order is not pending payment",
          metadata: {
            orderId: payment.orderId,
            orderStatus: payment.order.status,
            paymentStatus: payment.status,
          },
        },
      });
      return reply.code(409).send({ error: "Order is not pending payment" });
    }

    const providerCallback = await providers.payment.applySuccessCallback({
      paymentId: payment.id,
    });

    const updated = await db.$transaction(async (tx) => {
      const nextPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          channelTradeNo: providerCallback.channelTradeNo,
          callbackNonce: providerCallback.callbackNonce,
        },
      });
      await tx.order.update({
        where: { id: payment.orderId },
        data: { status: OrderStatus.PAID_PENDING_GROUP },
      });
      await tx.auditLog.create({
        data: {
          action: "payment.callback.succeeded",
          targetType: "Payment",
          targetId: payment.id,
          metadata: {
            orderId: payment.orderId,
            fromOrderStatus: payment.order.status,
            toOrderStatus: OrderStatus.PAID_PENDING_GROUP,
          },
        },
      });
      return nextPayment;
    });

    return { payment: updated, idempotent: false };
  });

  app.post("/api/ops/refunds/:id/approve", async (request, reply) => {
    const auth = await requireOps(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ reason: z.string().min(1).max(200) }).parse(request.body);
    const refund = await db.$transaction(async (tx) => {
      const currentRefund = await tx.refund.findUnique({
        where: { id: params.id },
        include: { order: true },
      });
      if (!currentRefund) {
        return { error: "Refund not found", statusCode: 404 as const };
      }
      if (
        !canApproveRefund(currentRefund.status, currentRefund.order.status)
      ) {
        await tx.auditLog.create({
          data: {
            actorId: auth.sub,
            actorRole: auth.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
            action: "refund.approve.rejected",
            targetType: "Refund",
            targetId: currentRefund.id,
            reason: body.reason,
            metadata: {
              orderId: currentRefund.orderId,
              orderStatus: currentRefund.order.status,
              refundStatus: currentRefund.status,
            },
          },
        });
        return { error: "Refund cannot be approved from current state", statusCode: 409 as const };
      }
      const nextRefund = await tx.refund.update({
        where: { id: params.id },
        data: { status: RefundStatus.REFUNDING },
      });
      await tx.order.update({
        where: { id: nextRefund.orderId },
        data: { status: OrderStatus.REFUNDING },
      });
      await tx.auditLog.create({
        data: {
          actorId: auth.sub,
          actorRole: auth.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
          action: "refund.approve",
          targetType: "Refund",
          targetId: nextRefund.id,
          reason: body.reason,
        },
      });
      return { refund: nextRefund };
    });

    if ("error" in refund && typeof refund.statusCode === "number") {
      return reply.code(refund.statusCode).send({ error: refund.error });
    }

    return { refund: refund.refund };
  });

  app.post("/api/mock/refunds/:refundId/succeed", async (request, reply) => {
    const params = z.object({ refundId: z.string() }).parse(request.params);
    const refund = await db.refund.findUnique({
      where: { id: params.refundId },
      include: { order: true },
    });
    if (!refund) {
      return reply.code(404).send({ error: "Refund not found" });
    }
    const refundDecision = canApplyRefundCallback(refund.status, refund.order.status);
    if (refundDecision === "idempotent") {
      return { refund, idempotent: true };
    }
    if (refundDecision === "reject") {
      await db.auditLog.create({
        data: {
          action: "refund.callback.rejected",
          targetType: "Refund",
          targetId: refund.id,
          reason: "Refund or order is not refunding",
          metadata: {
            orderId: refund.orderId,
            orderStatus: refund.order.status,
            refundStatus: refund.status,
          },
        },
      });
      return reply.code(409).send({ error: "Refund is not ready for callback" });
    }

    const providerCallback = await providers.refund.applySuccessCallback({
      refundId: refund.id,
    });

    const updated = await db.$transaction(async (tx) => {
      const nextRefund = await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: RefundStatus.SUCCEEDED,
          channelRefundNo: providerCallback.channelRefundNo,
          callbackNonce: providerCallback.callbackNonce,
        },
      });
      await tx.order.update({
        where: { id: refund.orderId },
        data: { status: OrderStatus.REFUNDED },
      });
      await tx.auditLog.create({
        data: {
          action: "refund.callback.succeeded",
          targetType: "Refund",
          targetId: refund.id,
          metadata: {
            orderId: refund.orderId,
            fromOrderStatus: refund.order.status,
            toOrderStatus: OrderStatus.REFUNDED,
          },
        },
      });
      return nextRefund;
    });

    return { refund: updated, idempotent: false };
  });

  app.post("/api/mock/refunds/:refundId/fail", async (request, reply) => {
    const params = z.object({ refundId: z.string() }).parse(request.params);
    const body = z.object({ reason: z.string().min(1).max(200) }).parse(request.body);
    const refund = await db.refund.findUnique({
      where: { id: params.refundId },
      include: { order: true },
    });
    if (!refund) {
      return reply.code(404).send({ error: "Refund not found" });
    }
    if (canApplyRefundCallback(refund.status, refund.order.status) !== "apply") {
      return reply.code(409).send({ error: "Refund is not ready for callback" });
    }

    const providerCallback = await providers.refund.applyFailureCallback({
      refundId: refund.id,
      reason: body.reason,
    });

    const updated = await db.$transaction(async (tx) => {
      const nextRefund = await tx.refund.update({
        where: { id: refund.id },
        data: { status: RefundStatus.FAILED },
      });
      await tx.order.update({
        where: { id: refund.orderId },
        data: { status: OrderStatus.REFUND_REVIEWING },
      });
      await tx.auditLog.create({
        data: {
          action: "refund.callback.failed",
          targetType: "Refund",
          targetId: refund.id,
          reason: providerCallback.failureReason,
          metadata: {
            orderId: refund.orderId,
            fromOrderStatus: refund.order.status,
            toOrderStatus: OrderStatus.REFUND_REVIEWING,
          },
        },
      });
      return nextRefund;
    });

    return { refund: updated };
  });

  return app;
}

const publicActivitySelect = {
  id: true,
  title: true,
  theme: true,
  description: true,
  district: true,
  businessArea: true,
  startsAt: true,
  endsAt: true,
  registrationEndsAt: true,
  serviceFeeCents: true,
  mealFeeIncluded: true,
  mealFeePolicyText: true,
  status: true,
} as const;

const restaurantInputSchema = z.object({
  name: z.string().min(1),
  district: z.string().min(1),
  businessArea: z.string().min(1),
  address: z.string().min(1),
  contactName: z.string().min(1),
  contactPhone: phoneSchema,
  budgetCents: z.number().int().positive(),
  cuisineTags: z.array(z.string()).default([]),
  capacity: z.number().int().min(4),
});

const activityInputSchema = z.object({
  restaurantId: z.string(),
  title: z.string().min(1),
  theme: z.string().min(1),
  description: z.string().min(1),
  district: z.string().min(1),
  businessArea: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  registrationEndsAt: z.string().datetime(),
  serviceFeeCents: z.number().int().positive(),
  mealFeeIncluded: z.literal(false),
  mealFeePolicyText: z.string().min(1),
  minSize: z.number().int().min(4).default(4),
  targetSize: z.number().int().min(4).max(8).default(6),
  maxSize: z.number().int().min(4).max(8).default(8),
  capacity: z.number().int().min(4),
  status: z.enum(["DRAFT", "PUBLISHED", "REGISTRATION_OPEN"]).default("DRAFT"),
});

const CAPACITY_HOLD_ORDER_STATUSES: OrderStatus[] =
  Object.values(OrderStatus).filter(isCapacityHoldingOrderStatus);

function maskPhone(phone: string | null): string | null {
  if (!phone) {
    return null;
  }

  if (phone.length <= 6) {
    return "***";
  }

  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function getOrderVisibility(
  orderStatus: OrderStatus,
  activityStatus: ActivityStatus,
  startsAt: Date,
): "none" | "basic" | "restaurant" | "address" {
  if (!isPaidEffectivePrismaOrder(orderStatus)) {
    return "none";
  }
  if (!isGroupedOrLaterActivity(activityStatus)) {
    return "basic";
  }

  const unlockAt = startsAt.getTime() - 24 * 60 * 60 * 1000;
  return Date.now() >= unlockAt ? "address" : "restaurant";
}

function canCreateOrder(status: ActivityStatus): boolean {
  return (
    status === ActivityStatus.PUBLISHED ||
    status === ActivityStatus.REGISTRATION_OPEN
  );
}

function isCapacityHoldingOrderStatus(status: OrderStatus): boolean {
  return (
    status === OrderStatus.PENDING_PAYMENT ||
    status === OrderStatus.PAID_PENDING_GROUP ||
    status === OrderStatus.GROUPED ||
    status === OrderStatus.REFUND_REVIEWING ||
    status === OrderStatus.REFUNDING ||
    status === OrderStatus.COMPLETED
  );
}

function canApplyPaymentSuccess(
  paymentStatus: PaymentStatus,
  orderStatus: OrderStatus,
): "apply" | "idempotent" | "reject" {
  if (paymentStatus === PaymentStatus.SUCCEEDED) {
    return "idempotent";
  }
  if (
    paymentStatus === PaymentStatus.PENDING &&
    orderStatus === OrderStatus.PENDING_PAYMENT
  ) {
    return "apply";
  }
  return "reject";
}

function canRequestCancel(status: OrderStatus): boolean {
  return (
    status === OrderStatus.PAID_PENDING_GROUP || status === OrderStatus.GROUPED
  );
}

function canApproveRefund(
  refundStatus: RefundStatus,
  orderStatus: OrderStatus,
): boolean {
  const refundIsReviewable =
    refundStatus === RefundStatus.REVIEWING ||
    refundStatus === RefundStatus.FAILED;
  const orderIsReviewable =
    orderStatus === OrderStatus.REFUND_REVIEWING ||
    orderStatus === OrderStatus.REFUND_REQUESTED;
  return refundIsReviewable && orderIsReviewable;
}

function canApplyRefundCallback(
  refundStatus: RefundStatus,
  orderStatus: OrderStatus,
): "apply" | "idempotent" | "reject" {
  if (
    refundStatus === RefundStatus.SUCCEEDED &&
    orderStatus === OrderStatus.REFUNDED
  ) {
    return "idempotent";
  }
  if (
    refundStatus === RefundStatus.REFUNDING &&
    orderStatus === OrderStatus.REFUNDING
  ) {
    return "apply";
  }
  return "reject";
}

function isPaidEffectivePrismaOrder(status: OrderStatus): boolean {
  return (
    status === OrderStatus.PAID_PENDING_GROUP ||
    status === OrderStatus.GROUPED ||
    status === OrderStatus.COMPLETED
  );
}

function isGroupedOrLaterActivity(status: ActivityStatus): boolean {
  return (
    status === ActivityStatus.GROUPED ||
    status === ActivityStatus.ADDRESS_UNLOCKED ||
    status === ActivityStatus.IN_PROGRESS ||
    status === ActivityStatus.COMPLETED
  );
}
