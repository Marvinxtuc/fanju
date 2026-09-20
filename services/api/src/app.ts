import cors from "@fastify/cors";
import { readFileSync } from "node:fs";
import {
  ActivityStatus,
  OrderStatus,
  PaymentStatus,
  NotificationStatus,
  ReportStatus,
  RefundStatus,
  type PrismaClient,
} from "./generated/prisma/client.js";
import {
  assertActivityTransition,
  assertOrderTransition,
  assertVisibleCopyAllowed,
  calculateOrderAmountCents,
  evaluateTableFormation,
  type ActivityStatus as SharedActivityStatus,
  type OrderStatus as SharedOrderStatus,
} from "@timeleft-shanghai/shared";
import Fastify from "fastify";
import { z, ZodError } from "zod";
import { registerAuth, requireOps, requireSuperAdmin, requireUser } from "./auth.js";
import { prisma as defaultPrisma } from "./prisma.js";
import {
  createWechatProviders,
  ProviderConfigError,
  type ProviderHttpClient,
  ProviderUnavailableError,
  type ProviderEnv,
} from "./providers.js";
import {
  verifyPaymentNotification,
  verifyRefundNotification,
  type WechatPayNotificationConfig,
} from "./wechat-pay.js";

const phoneSchema = z.string().regex(/^\+?\d{8,15}$/);

export interface BuildAppOptions {
  prisma?: PrismaClient;
  providerEnv?: ProviderEnv;
  providerHttpClient?: ProviderHttpClient;
  wechatPayNotificationConfig?: WechatPayNotificationConfig;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const db = options.prisma ?? defaultPrisma;
  const providerEnv = options.providerEnv ?? process.env;
  const providers = createWechatProviders(providerEnv, {
    ...(options.providerHttpClient === undefined
      ? {}
      : { httpClient: options.providerHttpClient }),
  });
  const app = Fastify({ logger: true });
  const callbackBodies = new WeakMap<object, string>();

  app.addHook("preParsing", (request, _reply, payload, done) => {
    if (
      request.url === "/api/wechat/pay/notify" ||
      request.url === "/api/wechat/refund/notify"
    ) {
      const chunks: Buffer[] = [];
      payload.on("data", (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      payload.on("end", () => {
        callbackBodies.set(request, Buffer.concat(chunks).toString("utf8"));
      });
    }
    done(null, payload);
  });

  await app.register(cors, { origin: true, methods: ["GET", "HEAD", "POST", "PUT"] });
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
    const user = await upsertWechatUser(db, identity);
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

  app.post("/api/consents", async (request) => {
    const auth = await requireUser(request);
    const body = z.object({
      agreementVersion: z.string().trim().min(1).max(100),
      source: z.string().trim().min(1).max(100),
    }).parse(request.body);
    const consent = await db.$transaction(async (tx) => {
      const existing = await tx.consentRecord.findFirst({
        where: { userId: auth.sub, agreementVersion: body.agreementVersion },
        orderBy: { createdAt: "desc" },
      });
      if (existing) return existing;
      const next = await tx.consentRecord.create({
        data: { userId: auth.sub, agreementVersion: body.agreementVersion, source: body.source },
      });
      await tx.auditLog.create({
        data: {
          action: "consent.confirmed",
          targetType: "ConsentRecord",
          targetId: next.id,
          metadata: { agreementVersion: next.agreementVersion, source: next.source },
        },
      });
      return next;
    });
    return { consent: { id: consent.id, agreementVersion: consent.agreementVersion, createdAt: consent.createdAt } };
  });

  app.get("/api/profile", async (request) => {
    const auth = await requireUser(request);
    const profile = await db.userProfile.findUnique({
      where: { userId: auth.sub },
    });
    return { profile };
  });

  app.put("/api/profile", async (request) => {
    const auth = await requireUser(request);
    const body = profileInputSchema.parse(request.body);
    const { note, ...profileFields } = body;
    const profileData = {
      ...profileFields,
      ...(note === undefined ? {} : { note }),
    };
    const profile = await db.$transaction(async (tx) => {
      const next = await tx.userProfile.upsert({
        where: { userId: auth.sub },
        create: { userId: auth.sub, ...profileData },
        update: profileData,
      });
      await tx.auditLog.create({
        data: {
          action: "profile.upsert",
          targetType: "UserProfile",
          targetId: next.id,
          metadata: { userId: auth.sub, hasNote: note !== undefined },
        },
      });
      return next;
    });
    return { profile };
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

  app.post("/api/ops/activities/:id/start", async (request, reply) => {
    const operator = await requireOps(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${params.id} FOR UPDATE`;
      const activity = await tx.activity.findUnique({ where: { id: params.id } });
      if (!activity) return { kind: "not_found" as const };
      if (activity.status === ActivityStatus.IN_PROGRESS) return { kind: "already_started" as const };
      if (activity.status !== ActivityStatus.GROUPED && activity.status !== ActivityStatus.ADDRESS_UNLOCKED) return { kind: "invalid_status" as const };
      if (Date.now() < activity.startsAt.getTime()) return { kind: "too_early" as const };
      assertActivityTransition(toSharedActivityStatus(activity.status), "in_progress");
      await tx.activity.update({ where: { id: activity.id }, data: { status: ActivityStatus.IN_PROGRESS } });
      await tx.auditLog.create({
        data: {
          actorId: operator.sub,
          actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
          action: "activity.started",
          targetType: "Activity",
          targetId: activity.id,
        },
      });
      return { kind: "started" as const };
    });
    if (result.kind === "not_found") return reply.code(404).send({ error: "Activity not found" });
    if (result.kind === "too_early") return reply.code(409).send({ error: "Activity has not started" });
    if (result.kind === "invalid_status") return reply.code(409).send({ error: "Activity cannot be started in its current status" });
    return { idempotent: result.kind === "already_started", activityStatus: ActivityStatus.IN_PROGRESS };
  });

  app.post("/api/ops/activities/:id/complete", async (request, reply) => {
    const operator = await requireOps(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${params.id} FOR UPDATE`;
      const activity = await tx.activity.findUnique({ where: { id: params.id } });
      if (!activity) return { kind: "not_found" as const };
      if (activity.status === ActivityStatus.COMPLETED) return { kind: "already_completed" as const };
      if (activity.status !== ActivityStatus.IN_PROGRESS) return { kind: "invalid_status" as const };
      if (Date.now() < activity.endsAt.getTime()) return { kind: "too_early" as const };
      const groupedOrders = await tx.order.findMany({ where: { activityId: activity.id, status: OrderStatus.GROUPED }, select: { id: true, status: true } });
      assertActivityTransition(toSharedActivityStatus(activity.status), "completed");
      for (const order of groupedOrders) assertOrderTransition(toSharedOrderStatus(order.status), "completed");
      await tx.order.updateMany({ where: { id: { in: groupedOrders.map((order) => order.id) }, status: OrderStatus.GROUPED }, data: { status: OrderStatus.COMPLETED } });
      await tx.activity.update({ where: { id: activity.id }, data: { status: ActivityStatus.COMPLETED } });
      await tx.auditLog.create({
        data: {
          actorId: operator.sub,
          actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
          action: "activity.completed",
          targetType: "Activity",
          targetId: activity.id,
          metadata: { completedOrderCount: groupedOrders.length },
        },
      });
      return { kind: "completed" as const, completedOrderCount: groupedOrders.length };
    });
    if (result.kind === "not_found") return reply.code(404).send({ error: "Activity not found" });
    if (result.kind === "too_early") return reply.code(409).send({ error: "Activity has not ended" });
    if (result.kind === "invalid_status") return reply.code(409).send({ error: "Activity cannot be completed in its current status" });
    if (result.kind === "already_completed") return { idempotent: true, activityStatus: ActivityStatus.COMPLETED, completedOrderCount: 0 };
    return { idempotent: false, activityStatus: ActivityStatus.COMPLETED, completedOrderCount: result.completedOrderCount };
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

  app.get("/api/notifications", async (request) => {
    const auth = await requireUser(request);
    const notifications = await db.notification.findMany({
      where: { userId: auth.sub },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      notifications: notifications.map((notification) => ({
        id: notification.id,
        type: notification.type,
        status: notification.status,
        payload: notification.payload,
        createdAt: notification.createdAt,
      })),
    };
  });

  app.get("/api/ops/reports", async (request) => {
    await requireOps(request);
    const reports = await db.report.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { order: { include: { activity: true } } },
    });
    return {
      reports: reports.map((report) => ({
        id: report.id,
        type: report.type,
        content: report.content,
        status: report.status,
        createdAt: report.createdAt,
        order: { id: report.order.id, status: report.order.status, activityTitle: report.order.activity.title },
      })),
    };
  });

  app.get("/api/ops/reviews", async (request) => {
    await requireOps(request);
    const reviews = await db.review.findMany({
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { order: { include: { activity: true } } },
    });
    return {
      reviews: reviews.map((review) => ({
        id: review.id,
        score: review.score,
        tags: review.tags,
        content: review.content,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
        order: { id: review.order.id, activityTitle: review.order.activity.title },
      })),
    };
  });

  app.get("/api/ops/blacklist", async (request) => {
    await requireOps(request);
    const entries = await db.blacklist.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: true },
    });
    return {
      entries: entries.map((entry) => ({
        id: entry.id,
        userId: entry.userId,
        reason: entry.reason,
        createdAt: entry.createdAt,
        user: { phone: maskPhone(entry.user.phone), status: entry.user.status },
      })),
    };
  });

  app.post("/api/ops/blacklist", async (request, reply) => {
    const operator = await requireOps(request);
    const body = z.object({ userId: z.string(), reason: z.string().trim().min(1).max(200) }).parse(request.body);
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: body.userId } });
      if (!user) return { kind: "not_found" as const };
      const existing = await tx.blacklist.findUnique({ where: { userId: user.id } });
      if (existing) return { kind: "existing" as const, entry: existing };
      const entry = await tx.blacklist.create({ data: { userId: user.id, reason: body.reason } });
      await tx.user.update({ where: { id: user.id }, data: { status: "BLACKLISTED" } });
      await tx.auditLog.create({
        data: {
          actorId: operator.sub,
          actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
          action: "blacklist.added",
          targetType: "User",
          targetId: user.id,
          reason: body.reason,
        },
      });
      return { kind: "created" as const, entry };
    });
    if (result.kind === "not_found") return reply.code(404).send({ error: "User not found" });
    return { idempotent: result.kind === "existing", entry: result.entry };
  });

  app.delete("/api/ops/blacklist/:userId", async (request, reply) => {
    const operator = await requireSuperAdmin(request);
    const params = z.object({ userId: z.string() }).parse(request.params);
    const body = z.object({ reason: z.string().trim().min(1).max(200) }).parse(request.body);
    const result = await db.$transaction(async (tx) => {
      const entry = await tx.blacklist.findUnique({ where: { userId: params.userId } });
      if (!entry) return null;
      await tx.blacklist.delete({ where: { id: entry.id } });
      await tx.user.update({ where: { id: params.userId }, data: { status: "NORMAL" } });
      await tx.auditLog.create({
        data: {
          actorId: operator.sub,
          actorRole: "SUPER_ADMIN",
          action: "blacklist.removed",
          targetType: "User",
          targetId: params.userId,
          reason: body.reason,
        },
      });
      return entry;
    });
    if (!result) return reply.code(404).send({ error: "Blacklist entry not found" });
    return { removed: true };
  });

  app.post("/api/ops/reports/:id/resolve", async (request, reply) => {
    const operator = await requireOps(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ status: z.enum(["RESOLVED", "REJECTED"]), reason: z.string().trim().min(1).max(200) }).parse(request.body);
    const report = await db.$transaction(async (tx) => {
      const current = await tx.report.findUnique({ where: { id: params.id } });
      if (!current) return null;
      if (current.status !== ReportStatus.OPEN) return "already_processed" as const;
      const next = await tx.report.update({ where: { id: current.id }, data: { status: body.status } });
      await tx.auditLog.create({ data: {
        actorId: operator.sub,
        actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
        action: "report.resolved",
        targetType: "Report",
        targetId: current.id,
        reason: body.reason,
        metadata: { status: body.status },
      } });
      return next;
    });
    if (report === null) return reply.code(404).send({ error: "Report not found" });
    if (report === "already_processed") return reply.code(409).send({ error: "Report has already been processed" });
    return { report };
  });

  app.get("/api/ops/activities/:id/table-candidates", async (request, reply) => {
    await requireOps(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const activity = await db.activity.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!activity) {
      return reply.code(404).send({ error: "Activity not found" });
    }

    const [orders, tableGroups] = await Promise.all([
      db.order.findMany({
      where: { activityId: activity.id, status: OrderStatus.PAID_PENDING_GROUP },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        status: true,
        createdAt: true,
        user: {
          select: {
            profile: {
              select: {
                preferredAreas: true,
                availableTimes: true,
                tastePreferences: true,
                dietaryRestrictions: true,
                budgetRange: true,
                tableVibe: true,
                acceptableTableSizes: true,
              },
            },
          },
        },
      },
      }),
      db.tableGroup.findMany({
        where: { activityId: activity.id, status: "PENDING_CONFIRMATION" },
        orderBy: { createdAt: "asc" },
        include: { members: { orderBy: { createdAt: "asc" } } },
      }),
    ]);

    return {
      candidates: orders.map((order) => ({
        order: {
          id: order.id,
          status: order.status,
          createdAt: order.createdAt,
        },
        profile: order.user.profile,
      })),
      tableGroups: serializeTableGroups(tableGroups),
    };
  });

  app.post("/api/ops/activities/:id/table-groups/draft", async (request, reply) => {
    const operator = await requireOps(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${params.id} FOR UPDATE`;
      const activity = await tx.activity.findUnique({ where: { id: params.id } });
      if (!activity) {
        return { kind: "not_found" as const };
      }

      const existingGroups = await tx.tableGroup.findMany({
        where: { activityId: activity.id },
        orderBy: { createdAt: "asc" },
        include: { members: { orderBy: { createdAt: "asc" } } },
      });
      if (existingGroups.length > 0) {
        return { kind: "existing" as const, existingGroups };
      }
      if (activity.status !== ActivityStatus.REGISTRATION_OPEN) {
        return { kind: "invalid_activity_status" as const, status: activity.status };
      }

      const eligibleOrders = await tx.order.findMany({
        where: { activityId: activity.id, status: OrderStatus.PAID_PENDING_GROUP },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      const decision = evaluateTableFormation(eligibleOrders.length, {
        minSize: activity.minSize,
        targetSize: activity.targetSize,
        maxSize: activity.maxSize,
      });
      if (!decision.canForm) {
        return { kind: "not_enough" as const, decision };
      }

      assertActivityTransition(toSharedActivityStatus(activity.status), "locking");
      let orderOffset = 0;
      const tableGroups = [];
      for (const tableSize of decision.tableSizes) {
        const memberOrders = eligibleOrders.slice(orderOffset, orderOffset + tableSize);
        orderOffset += tableSize;
        tableGroups.push(await tx.tableGroup.create({
          data: {
            activityId: activity.id,
            members: { create: memberOrders.map((order) => ({ orderId: order.id })) },
          },
          include: { members: { orderBy: { createdAt: "asc" } } },
        }));
      }
      await tx.activity.update({
        where: { id: activity.id },
        data: { status: ActivityStatus.LOCKING },
      });
      await tx.auditLog.create({
        data: {
          actorId: operator.sub,
          actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
          action: "table-groups.drafted",
          targetType: "Activity",
          targetId: activity.id,
          metadata: { tableCount: tableGroups.length, eligibleOrderCount: eligibleOrders.length },
        },
      });
      return { kind: "created" as const, decision, tableGroups };
    });

    if (result.kind === "not_found") {
      return reply.code(404).send({ error: "Activity not found" });
    }
    if (result.kind === "invalid_activity_status") {
      return reply.code(409).send({ error: "Activity cannot be grouped in its current status" });
    }
    if (result.kind === "not_enough") {
      return reply.code(409).send({
        error: "Not enough paid orders to form valid tables",
        decision: result.decision,
      });
    }
    if (result.kind === "existing") {
      return { idempotent: true, tableGroups: serializeTableGroups(result.existingGroups) };
    }
    return {
      idempotent: false,
      decision: result.decision,
      tableGroups: serializeTableGroups(result.tableGroups),
    };
  });

  app.post("/api/ops/activities/:id/table-groups/confirm", async (request, reply) => {
    const operator = await requireOps(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${params.id} FOR UPDATE`;
      const activity = await tx.activity.findUnique({ where: { id: params.id } });
      if (!activity) {
        return { kind: "not_found" as const };
      }
      if (activity.status === ActivityStatus.GROUPED) {
        return { kind: "already_confirmed" as const };
      }
      if (activity.status !== ActivityStatus.LOCKING) {
        return { kind: "invalid_activity_status" as const };
      }

      const pendingGroups = await tx.tableGroup.findMany({
        where: { activityId: activity.id, status: "PENDING_CONFIRMATION" },
        include: { members: true },
      });
      const orderIds = pendingGroups.flatMap((group) => group.members.map((member) => member.orderId));
      if (pendingGroups.length === 0 || orderIds.length === 0) {
        return { kind: "missing_draft" as const };
      }

      const orders = await tx.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, status: true, userId: true } });
      if (orders.length !== orderIds.length || orders.some((order) => order.status !== OrderStatus.PAID_PENDING_GROUP)) {
        return { kind: "invalid_order_status" as const };
      }
      assertActivityTransition(toSharedActivityStatus(activity.status), "grouped");
      for (const order of orders) {
        assertOrderTransition(toSharedOrderStatus(order.status), "grouped");
      }

      await tx.order.updateMany({
        where: { id: { in: orderIds }, status: OrderStatus.PAID_PENDING_GROUP },
        data: { status: OrderStatus.GROUPED },
      });
      await tx.tableGroup.updateMany({
        where: { id: { in: pendingGroups.map((group) => group.id) } },
        data: { status: "CONFIRMED" },
      });
      await tx.activity.update({
        where: { id: activity.id },
        data: { status: ActivityStatus.GROUPED },
      });
      await tx.auditLog.create({
        data: {
          actorId: operator.sub,
          actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
          action: "table-groups.confirmed",
          targetType: "Activity",
          targetId: activity.id,
          metadata: { tableCount: pendingGroups.length, groupedOrderCount: orderIds.length },
        },
      });
      return { kind: "confirmed" as const, userIds: orders.map((order) => order.userId), activityTitle: activity.title };
    });

    if (result.kind === "not_found") {
      return reply.code(404).send({ error: "Activity not found" });
    }
    if (result.kind === "already_confirmed") {
      return { idempotent: true, activityStatus: ActivityStatus.GROUPED };
    }
    if (result.kind === "missing_draft") {
      return reply.code(409).send({ error: "Table grouping draft is required" });
    }
    if (result.kind === "invalid_activity_status" || result.kind === "invalid_order_status") {
      return reply.code(409).send({ error: "Table grouping cannot be confirmed in its current state" });
    }
    const notificationQueued = await enqueueInboxNotifications(app, db, result.userIds, "GROUP_CONFIRMED", {
      title: "饭局已成团",
      message: `${result.activityTitle} 已确认成团，餐厅信息将按规则逐步展示。`,
    });
    return { idempotent: false, activityStatus: ActivityStatus.GROUPED, notificationQueued };
  });

  app.put("/api/ops/activities/:id/table-groups", async (request, reply) => {
    const operator = await requireOps(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({
      tableGroups: z.array(z.object({ orderIds: z.array(z.string().min(1)).min(1) })).min(1),
    }).parse(request.body);
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${params.id} FOR UPDATE`;
      const activity = await tx.activity.findUnique({ where: { id: params.id } });
      if (!activity) return { kind: "not_found" as const };
      if (activity.status !== ActivityStatus.LOCKING) return { kind: "invalid_activity_status" as const };
      if (body.tableGroups.some((group) => group.orderIds.length < activity.minSize || group.orderIds.length > activity.maxSize)) {
        return { kind: "invalid_table_size" as const };
      }

      const existingGroups = await tx.tableGroup.findMany({
        where: { activityId: activity.id, status: "PENDING_CONFIRMATION" },
        include: { members: true },
      });
      const existingOrderIds = existingGroups.flatMap((group) => group.members.map((member) => member.orderId));
      const submittedOrderIds = body.tableGroups.flatMap((group) => group.orderIds);
      const uniqueSubmittedOrderIds = new Set(submittedOrderIds);
      if (
        existingOrderIds.length === 0
        || uniqueSubmittedOrderIds.size !== submittedOrderIds.length
        || existingOrderIds.length !== submittedOrderIds.length
        || existingOrderIds.some((orderId) => !uniqueSubmittedOrderIds.has(orderId))
      ) {
        return { kind: "invalid_members" as const };
      }

      await tx.tableGroup.deleteMany({ where: { id: { in: existingGroups.map((group) => group.id) } } });
      const tableGroups = [];
      for (const group of body.tableGroups) {
        tableGroups.push(await tx.tableGroup.create({
          data: {
            activityId: activity.id,
            members: { create: group.orderIds.map((orderId) => ({ orderId })) },
          },
          include: { members: { orderBy: { createdAt: "asc" } } },
        }));
      }
      await tx.auditLog.create({
        data: {
          actorId: operator.sub,
          actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
          action: "table-groups.adjusted",
          targetType: "Activity",
          targetId: activity.id,
          metadata: {
            previousTableCount: existingGroups.length,
            tableCount: tableGroups.length,
            orderCount: submittedOrderIds.length,
          },
        },
      });
      return { kind: "adjusted" as const, tableGroups };
    });

    if (result.kind === "not_found") return reply.code(404).send({ error: "Activity not found" });
    if (result.kind === "invalid_activity_status") return reply.code(409).send({ error: "Table grouping can only be adjusted while locking" });
    if (result.kind === "invalid_table_size") return reply.code(400).send({ error: "Each table must satisfy the activity table-size rules" });
    if (result.kind === "invalid_members") return reply.code(400).send({ error: "Adjusted tables must contain each drafted order exactly once" });
    return { tableGroups: serializeTableGroups(result.tableGroups) };
  });

  app.post("/api/ops/activities/:id/mark-group-failed", async (request, reply) => {
    const operator = await requireOps(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ reason: z.string().trim().min(1).max(200) }).parse(request.body);
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${params.id} FOR UPDATE`;
      const activity = await tx.activity.findUnique({ where: { id: params.id } });
      if (!activity) return { kind: "not_found" as const };
      if (activity.status === ActivityStatus.GROUP_FAILED) return { kind: "already_failed" as const };
      if (activity.status !== ActivityStatus.REGISTRATION_OPEN && activity.status !== ActivityStatus.LOCKING) {
        return { kind: "invalid_activity_status" as const };
      }
      if (Date.now() < activity.registrationEndsAt.getTime()) return { kind: "registration_open" as const };

      const [paidOrders, pendingPaymentCount] = await Promise.all([
        tx.order.findMany({
          where: { activityId: activity.id, status: OrderStatus.PAID_PENDING_GROUP },
          select: { id: true, status: true, userId: true },
        }),
        tx.order.count({ where: { activityId: activity.id, status: OrderStatus.PENDING_PAYMENT } }),
      ]);
      if (pendingPaymentCount > 0) return { kind: "pending_payment" as const };

      const decision = evaluateTableFormation(paidOrders.length, {
        minSize: activity.minSize,
        targetSize: activity.targetSize,
        maxSize: activity.maxSize,
      });
      if (decision.canForm) return { kind: "can_form" as const, decision };

      if (activity.status === ActivityStatus.REGISTRATION_OPEN) {
        assertActivityTransition(toSharedActivityStatus(activity.status), "locking");
      }
      assertActivityTransition("locking", "group_failed");
      for (const order of paidOrders) {
        assertOrderTransition(toSharedOrderStatus(order.status), "group_failed");
      }
      await tx.order.updateMany({
        where: { id: { in: paidOrders.map((order) => order.id) }, status: OrderStatus.PAID_PENDING_GROUP },
        data: { status: OrderStatus.GROUP_FAILED },
      });
      await tx.activity.update({ where: { id: activity.id }, data: { status: ActivityStatus.GROUP_FAILED } });
      await tx.auditLog.create({
        data: {
          actorId: operator.sub,
          actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
          action: "activity.group_failed",
          targetType: "Activity",
          targetId: activity.id,
          reason: body.reason,
          metadata: { affectedOrderCount: paidOrders.length, automaticRefund: false },
        },
      });
      return { kind: "marked" as const, affectedOrderCount: paidOrders.length, userIds: paidOrders.map((order) => order.userId), activityTitle: activity.title };
    });

    if (result.kind === "not_found") return reply.code(404).send({ error: "Activity not found" });
    if (result.kind === "invalid_activity_status") return reply.code(409).send({ error: "Activity cannot be marked group failed in its current status" });
    if (result.kind === "registration_open") return reply.code(409).send({ error: "Registration has not ended" });
    if (result.kind === "pending_payment") return reply.code(409).send({ error: "Pending payments must be handled before marking group failed" });
    if (result.kind === "can_form") return reply.code(409).send({ error: "Eligible paid orders can still form valid tables", decision: result.decision });
    if (result.kind === "already_failed") return { idempotent: true, activityStatus: ActivityStatus.GROUP_FAILED };
    const notificationQueued = await enqueueInboxNotifications(app, db, result.userIds, "GROUP_FAILED", {
      title: "本次饭局未能成团",
      message: `${result.activityTitle} 未能满足成团人数，后续处置请留意订单状态。`,
    });
    return { idempotent: false, activityStatus: ActivityStatus.GROUP_FAILED, affectedOrderCount: result.affectedOrderCount, notificationQueued };
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
    const consent = await db.consentRecord.findFirst({
      where: { userId: auth.sub, agreementVersion: body.agreementVersion },
      select: { id: true },
    });
    if (!consent) {
      return reply.code(409).send({ error: "Agreement confirmation required" });
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
          endsAt: order.activity.endsAt,
          restaurantName:
            visibility === "restaurant" || visibility === "address"
              ? order.activity.restaurant.name
              : null,
          address: visibility === "address" ? order.activity.restaurant.address : null,
        },
      },
    };
  });

  app.post("/api/orders/:id/reports", async (request, reply) => {
    const auth = await requireUser(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ type: z.string().trim().min(1).max(40), content: z.string().trim().min(1).max(1000) }).parse(request.body);
    const order = await db.order.findUnique({ where: { id: params.id }, include: { activity: true } });
    if (!order || order.userId !== auth.sub) return reply.code(404).send({ error: "Order not found" });
    if (Date.now() < order.activity.endsAt.getTime()) return reply.code(409).send({ error: "Report is available after the activity ends" });
    const deadline = order.activity.endsAt.getTime() + 7 * 24 * 60 * 60 * 1000;
    if (Date.now() > deadline) return reply.code(409).send({ error: "Report submission window has ended" });
    const report = await db.report.create({ data: { userId: auth.sub, orderId: order.id, type: body.type, content: body.content } });
    return { report: { id: report.id, type: report.type, status: report.status, createdAt: report.createdAt } };
  });

  app.put("/api/orders/:id/review", async (request, reply) => {
    const auth = await requireUser(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({
      score: z.number().int().min(1).max(5),
      tags: z.array(z.string().trim().min(1).max(40)).max(8),
      content: z.string().trim().min(1).max(1000).optional(),
    }).parse(request.body);
    const order = await db.order.findUnique({ where: { id: params.id }, select: { id: true, userId: true, status: true } });
    if (!order || order.userId !== auth.sub) return reply.code(404).send({ error: "Order not found" });
    if (order.status !== OrderStatus.COMPLETED) return reply.code(409).send({ error: "Review is available after the activity is completed" });
    const review = await db.review.upsert({
      where: { orderId: order.id },
      create: { userId: auth.sub, orderId: order.id, score: body.score, tags: body.tags, content: body.content ?? null },
      update: { score: body.score, tags: body.tags, content: body.content ?? null },
    });
    return {
      review: {
        id: review.id,
        score: review.score,
        tags: review.tags,
        content: review.content,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
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
    const order = await db.order.findUnique({
      where: { id: body.orderId },
      include: { user: true },
    });
    if (!order || order.userId !== auth.sub) {
      return reply.code(404).send({ error: "Order not found" });
    }
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      return reply.code(400).send({ error: "Order is not pending payment" });
    }

    const payment = await db.payment.create({
      data: {
        orderId: order.id,
        amountCents: order.amountCents,
        channel: providers.payment.mode,
      },
    });

    try {
      const providerPayment = await providers.payment.createPayment({
        merchantOrderNo: payment.merchantOrderNo,
        amountCents: order.amountCents,
        openid: order.user.wechatOpenid,
      });
      const updatedPayment = await db.payment.update({
        where: { id: payment.id },
        data: {
          channel: providerPayment.channel,
          ...(providerPayment.prepayId === undefined ? {} : { prepayId: providerPayment.prepayId }),
        },
      });
      return { payment: updatedPayment, ...(providerPayment.paymentParams === undefined ? {} : { paymentParams: providerPayment.paymentParams }) };
    } catch (error) {
      await db.payment.delete({ where: { id: payment.id } });
      throw error;
    }
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

    const approvedRefund = refund.refund;
    try {
      const payment = await db.payment.findFirst({
        where: { orderId: approvedRefund.orderId, status: PaymentStatus.SUCCEEDED },
        orderBy: { createdAt: "desc" },
      });
      if (!payment) {
        throw new ProviderUnavailableError("Refund requires a successful payment");
      }
      const providerRefund = await providers.refund.createRefund({
        merchantRefundNo: approvedRefund.merchantRefundNo,
        merchantOrderNo: payment.merchantOrderNo,
        amountCents: approvedRefund.amountCents,
      });
      const updatedRefund = await db.refund.update({
        where: { id: approvedRefund.id },
        data: {
          ...(providerRefund.channelRefundNo === undefined ? {} : { channelRefundNo: providerRefund.channelRefundNo }),
        },
      });
      return { refund: updatedRefund };
    } catch (error) {
      await db.$transaction(async (tx) => {
        await tx.refund.update({
          where: { id: approvedRefund.id },
          data: { status: RefundStatus.FAILED },
        });
        await tx.order.update({
          where: { id: approvedRefund.orderId },
          data: { status: OrderStatus.REFUND_REVIEWING },
        });
        await tx.auditLog.create({
          data: {
            actorId: auth.sub,
            actorRole: auth.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
            action: "refund.request.failed",
            targetType: "Refund",
            targetId: approvedRefund.id,
            reason: "Channel refund request failed",
          },
        });
      });
      throw error;
    }
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

  app.post("/api/wechat/pay/notify", async (request, reply) => {
    if (!realWechatPayEnabled(providerEnv, providers.payment.mode)) {
      return reply.code(404).send({ error: "Not found" });
    }
    const rawBody = callbackBodies.get(request);
    if (!rawBody) return reply.code(400).send({ error: "Missing raw callback body" });
    const callback = verifyPaymentNotification(
      rawBody,
      request.headers,
      options.wechatPayNotificationConfig ?? notificationConfigFromEnv(providerEnv),
    );
    const payment = await db.payment.findUnique({
      where: { merchantOrderNo: callback.merchantOrderNo },
      include: { order: true },
    });
    if (!payment || payment.amountCents !== callback.amountCents || payment.order.amountCents !== callback.amountCents) {
      return reply.code(409).send({ error: "Payment callback does not match a pending order" });
    }
    const decision = canApplyPaymentSuccess(payment.status, payment.order.status);
    if (decision === "idempotent") {
      if (payment.channelTradeNo !== callback.channelTradeNo || payment.callbackNonce !== callback.callbackNonce) {
        return reply.code(409).send({ error: "Payment callback conflicts with completed payment" });
      }
      return { code: "SUCCESS", idempotent: true };
    }
    if (decision === "reject") {
      await db.auditLog.create({
        data: { action: "payment.callback.rejected", targetType: "Payment", targetId: payment.id, reason: "Payment callback reached a non-pending order" },
      });
      return reply.code(409).send({ error: "Payment callback is not applicable" });
    }
    await db.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.SUCCEEDED, channelTradeNo: callback.channelTradeNo, callbackNonce: callback.callbackNonce },
      });
      await tx.order.update({ where: { id: payment.orderId }, data: { status: OrderStatus.PAID_PENDING_GROUP } });
      await tx.auditLog.create({
        data: { action: "payment.callback.succeeded", targetType: "Payment", targetId: payment.id, metadata: { orderId: payment.orderId, fromOrderStatus: payment.order.status, toOrderStatus: OrderStatus.PAID_PENDING_GROUP } },
      });
    });
    return { code: "SUCCESS", idempotent: false };
  });

  app.post("/api/wechat/refund/notify", async (request, reply) => {
    if (!realWechatPayEnabled(providerEnv, providers.refund.mode)) {
      return reply.code(404).send({ error: "Not found" });
    }
    const rawBody = callbackBodies.get(request);
    if (!rawBody) return reply.code(400).send({ error: "Missing raw callback body" });
    const callback = verifyRefundNotification(
      rawBody,
      request.headers,
      options.wechatPayNotificationConfig ?? notificationConfigFromEnv(providerEnv),
    );
    const refund = await db.refund.findUnique({
      where: { merchantRefundNo: callback.merchantRefundNo },
      include: { order: true },
    });
    if (!refund || refund.amountCents !== callback.amountCents) {
      return reply.code(409).send({ error: "Refund callback does not match a pending refund" });
    }
    const decision = canApplyRefundCallback(refund.status, refund.order.status);
    if (decision === "idempotent") {
      if (refund.channelRefundNo !== callback.channelRefundNo || refund.callbackNonce !== callback.callbackNonce) {
        return reply.code(409).send({ error: "Refund callback conflicts with completed refund" });
      }
      return { code: "SUCCESS", idempotent: true };
    }
    if (decision === "reject") {
      await db.auditLog.create({
        data: { action: "refund.callback.rejected", targetType: "Refund", targetId: refund.id, reason: "Refund callback reached a non-refunding order" },
      });
      return reply.code(409).send({ error: "Refund callback is not applicable" });
    }
    await db.$transaction(async (tx) => {
      await tx.refund.update({
        where: { id: refund.id },
        data: { status: RefundStatus.SUCCEEDED, channelRefundNo: callback.channelRefundNo, callbackNonce: callback.callbackNonce },
      });
      await tx.order.update({ where: { id: refund.orderId }, data: { status: OrderStatus.REFUNDED } });
      await tx.auditLog.create({
        data: { action: "refund.callback.succeeded", targetType: "Refund", targetId: refund.id, metadata: { orderId: refund.orderId, fromOrderStatus: refund.order.status, toOrderStatus: OrderStatus.REFUNDED } },
      });
    });
    return { code: "SUCCESS", idempotent: false };
  });

  return app;
}

function realWechatPayEnabled(env: ProviderEnv, mode: "mock" | "wechat"): boolean {
  return mode === "wechat" && env.FEATURE_REAL_WECHAT_PAY === "true";
}

function notificationConfigFromEnv(env: ProviderEnv): WechatPayNotificationConfig {
  const apiV3Key = env.WECHAT_PAY_API_V3_KEY;
  const certificatePath = env.WECHAT_PAY_PLATFORM_CERT_PATH;
  if (!apiV3Key || !certificatePath) {
    throw new ProviderConfigError("Missing WeChat Pay notification verification configuration");
  }
  return { apiV3Key, platformCertificate: readFileSync(certificatePath, "utf8") };
}

async function upsertWechatUser(
  db: PrismaClient,
  identity: { openid: string; unionid?: string },
) {
  const update = identity.unionid === undefined ? {} : { wechatUnionid: identity.unionid };
  try {
    return await db.user.upsert({
      where: { wechatOpenid: identity.openid },
      update,
      create: { wechatOpenid: identity.openid, ...update },
    });
  } catch (error) {
    if ((error as { code?: unknown }).code !== "P2002") {
      throw error;
    }

    const existing = await db.user.findUnique({ where: { wechatOpenid: identity.openid } });
    if (existing === null) {
      throw error;
    }
    if (identity.unionid === undefined || existing.wechatUnionid === identity.unionid) {
      return existing;
    }
    return db.user.update({ where: { id: existing.id }, data: update });
  }
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

const profileInputSchema = z.object({
  preferredAreas: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  availableTimes: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  tastePreferences: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  dietaryRestrictions: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
  budgetRange: z.string().trim().min(1).max(40),
  tableVibe: z.string().trim().min(1).max(80),
  acceptableTableSizes: z.array(z.number().int().min(4).max(8)).min(1).max(5),
  note: z.string().trim().min(1).max(500).optional(),
});

const CAPACITY_HOLD_ORDER_STATUSES: OrderStatus[] =
  Object.values(OrderStatus).filter(isCapacityHoldingOrderStatus);

async function enqueueInboxNotifications(
  app: { log: { warn: (details: object, message: string) => void } },
  db: PrismaClient,
  userIds: string[],
  type: "GROUP_CONFIRMED" | "GROUP_FAILED",
  payload: { title: string; message: string },
): Promise<boolean> {
  if (userIds.length === 0) return true;
  try {
    await db.notification.createMany({
      data: userIds.map((userId) => ({ userId, type, status: NotificationStatus.SENT, payload })),
    });
    return true;
  } catch (error) {
    app.log.warn({ error, type, recipientCount: userIds.length }, "inbox notification enqueue failed");
    return false;
  }
}

function toSharedActivityStatus(status: ActivityStatus): SharedActivityStatus {
  return status.toLowerCase() as SharedActivityStatus;
}

function toSharedOrderStatus(status: OrderStatus): SharedOrderStatus {
  return status.toLowerCase() as SharedOrderStatus;
}

function serializeTableGroups(
  tableGroups: Array<{ id: string; status: string; members: Array<{ orderId: string }> }>,
) {
  return tableGroups.map((tableGroup) => ({
    id: tableGroup.id,
    status: tableGroup.status,
    orderIds: tableGroup.members.map((member) => member.orderId),
  }));
}

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
