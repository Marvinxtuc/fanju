import { buildApp } from "./app.js";
import { prisma } from "./prisma.js";

const port = Number(process.env.API_PORT || 3000);
const host = process.env.API_HOST || "0.0.0.0";
const app = await buildApp();

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
}
