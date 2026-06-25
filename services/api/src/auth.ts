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
    throw new Error("User token required");
  }

  return payload;
}

export async function requireOps(
  request: FastifyRequest,
): Promise<AuthTokenPayload> {
  const payload = await request.jwtVerify<AuthTokenPayload>();
  if (payload.role !== "OPS" && payload.role !== "SUPER_ADMIN") {
    throw new Error("Ops token required");
  }

  return payload;
}
