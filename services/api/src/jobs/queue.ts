import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma, DurableJob } from "../generated/prisma/client.js";

export type Transaction = Prisma.TransactionClient;
export type Lease = DurableJob & { leaseOwner: string; leaseUntil: Date };
const LEASE_MS = 30_000;
const MAX_ATTEMPTS = 8;

export async function enqueue(tx: Transaction, kind: string, businessKey: string, refId: string, runAt?: Date) {
  await tx.$executeRaw`
    INSERT INTO "DurableJob" ("id", "kind", "businessKey", "refId", "runAt", "updatedAt")
    VALUES (${randomUUID()}, ${kind}, ${businessKey}, ${refId}, COALESCE(${runAt ?? null}::timestamp, clock_timestamp()), clock_timestamp())
    ON CONFLICT ("businessKey") DO NOTHING`;
  const job = await tx.durableJob.findUniqueOrThrow({ where: { businessKey } });
  if (job.kind !== kind || job.refId !== refId) throw new Error("Job business identity conflict");
  return job;
}

export async function openCase(tx: Transaction, category: string, sourceRef: string, owner: string) {
  return tx.financialCase.upsert({
    where: { caseKey: `${category}:${sourceRef}` }, update: {},
    create: { caseKey: `${category}:${sourceRef}`, category, sourceRef, owner,
      deadline: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  });
}

// Claiming and fencing use the database clock; a worker's local clock never extends a lease.
export async function claimJob(db: PrismaClient, owner: string, kinds?: string[]): Promise<Lease | null> {
  if (!owner.trim()) throw new Error("Worker owner required");
  const rows = await db.$queryRaw<Lease[]>`
    WITH next AS (
      SELECT "id" FROM "DurableJob"
      WHERE (("state" IN ('READY', 'RETRY') AND "runAt" <= clock_timestamp())
         OR ("state" = 'RUNNING' AND "leaseUntil" <= clock_timestamp()))
        AND (${kinds ?? null}::text[] IS NULL OR "kind" = ANY(${kinds ?? null}::text[]))
      ORDER BY "runAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE "DurableJob" AS j SET "state" = 'RUNNING', "leaseOwner" = ${owner},
      "leaseUntil" = clock_timestamp() + ${LEASE_MS} * interval '1 millisecond',
      "generation" = j."generation" + 1, "attempts" = j."attempts" + 1, "updatedAt" = clock_timestamp()
    FROM next WHERE j."id" = next."id" RETURNING j.*`;
  return rows[0] ?? null;
}

export async function finishJob(db: PrismaClient, lease: Lease): Promise<boolean> {
  const changed = await db.$executeRaw`
    UPDATE "DurableJob" SET "state" = 'DONE', "leaseOwner" = NULL, "leaseUntil" = NULL,
      "errorClass" = NULL, "updatedAt" = clock_timestamp()
    WHERE "id" = ${lease.id} AND "state" = 'RUNNING' AND "generation" = ${lease.generation}
      AND "leaseOwner" = ${lease.leaseOwner} AND "leaseUntil" > clock_timestamp()`;
  return changed === 1;
}

// Only a small classification is persisted. Provider messages may contain private fields.
export async function retryJob(db: PrismaClient, lease: Lease, owner: string, errorClass = "RECOVERY_REQUIRED", forceManual = false) {
  const classification = ["RECOVERY_REQUIRED", "UNSUPPORTED_PAYLOAD", "CHANNEL_UNAVAILABLE", "DATA_CONFLICT"].includes(errorClass)
    ? errorClass : "RECOVERY_REQUIRED";
  const manual = forceManual || lease.attempts >= MAX_ATTEMPTS;
  const delay = Math.min(30 * 60 * 1000, 30_000 * 2 ** Math.min(lease.attempts - 1, 16));
  return db.$transaction(async tx => {
    const changed = await tx.$executeRaw`
      UPDATE "DurableJob" SET "state" = ${manual ? "MANUAL" : "RETRY"}, "leaseOwner" = NULL,
        "leaseUntil" = NULL, "errorClass" = ${classification},
        "runAt" = clock_timestamp() + ${delay} * interval '1 millisecond', "updatedAt" = clock_timestamp()
      WHERE "id" = ${lease.id} AND "state" = 'RUNNING' AND "generation" = ${lease.generation}
        AND "leaseOwner" = ${lease.leaseOwner} AND "leaseUntil" > clock_timestamp()`;
    if (changed && manual) {
      await openCase(tx, "JOB_REQUIRES_REVIEW", lease.id, owner);
    }
    return changed === 1;
  });
}

export type JobHandler = (lease: Lease) => Promise<void>;
export async function runOne(db: PrismaClient, owner: string, caseOwner: string, handlers: Record<string, JobHandler>, kinds?: string[]) {
  const lease = await claimJob(db, owner, kinds);
  if (!lease) return false;
  const handler = handlers[lease.kind];
  // Repeated process deaths still consume the budget. Do not make a ninth channel call.
  if (lease.attempts > MAX_ATTEMPTS || lease.payloadVersion !== 1 || !handler) {
    await retryJob(db, lease, caseOwner, "UNSUPPORTED_PAYLOAD", true);
    return true;
  }
  try {
    await handler(lease);
    await finishJob(db, lease);
  } catch {
    await retryJob(db, lease, caseOwner);
  }
  return true;
}
