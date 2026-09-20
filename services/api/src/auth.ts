import type { FastifyInstance, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";

export interface AuthTokenPayload {
  sub: string;
  role: "USER" | "OPS" | "SUPER_ADMIN";
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(fastifyJwt, {
    secret: process.env.SESSION_SECRET || "local-dev-session-secret",
  });
}

export async function requireUser(
  request: FastifyRequest,
): Promise<AuthTokenPayload> {
  const payload = await request.jwtVerify<AuthTokenPayload>();
  if (payload.role !== "USER") {
    throw forbidden("User token required");
  }

  return payload;
}

export async function requireOps(
  request: FastifyRequest,
): Promise<AuthTokenPayload> {
  const payload = await request.jwtVerify<AuthTokenPayload>();
  if (payload.role !== "OPS" && payload.role !== "SUPER_ADMIN") {
    throw forbidden("Ops token required");
  }

  return payload;
}

export async function requireSuperAdmin(
  request: FastifyRequest,
): Promise<AuthTokenPayload> {
  const payload = await request.jwtVerify<AuthTokenPayload>();
  if (payload.role !== "SUPER_ADMIN") {
    throw forbidden("Super admin token required");
  }

  return payload;
}

function forbidden(message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 403;
  return error;
}
