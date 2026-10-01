import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";

export async function recordWorkerPoll(db: PrismaClient, mode: string, instanceId: string, version: string): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "WorkerHeartbeat" ("id", "mode", "instanceId", "version", "lastPolledAt")
    VALUES (${randomUUID()}, ${mode}, ${instanceId}, ${version}, clock_timestamp())
    ON CONFLICT ("mode", "instanceId") DO UPDATE
    SET "version" = EXCLUDED."version", "lastPolledAt" = clock_timestamp()`;
}

export async function hasCompleteBillCoverage(db: PrismaClient, scope: string, period: string): Promise<boolean> {
  const latest = await db.reconciliationBatch.findFirst({ where: { merchantScope: scope, period },
    orderBy: { decisionOrdinal: "desc" }, select: { coverageState: true } });
  return latest?.coverageState === "COMPLETE";
}

export async function checkReadiness(db: PrismaClient, requiredModes: string[], bill?: { scope: string; period: string }): Promise<{ ok: boolean; missingModes: string[]; billCovered: boolean | null }> {
  const check = db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '1500ms'");
    const migrations = await tx.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE migration_name = '20260930020000_reconciliation_decision_order' AND finished_at IS NOT NULL`;
    if (!migrations.length) return { ok: false, missingModes: requiredModes, billCovered: null };
    const rows = await tx.$queryRaw<Array<{ mode: string }>>`
      SELECT DISTINCT "mode" FROM "WorkerHeartbeat"
      WHERE "lastPolledAt" >= clock_timestamp() - interval '30 seconds'`;
    const live = new Set(rows.map(row => row.mode));
    const missingModes = requiredModes.filter(mode => !live.has(mode));
    const latestBill = bill ? await tx.reconciliationBatch.findFirst({ where: { merchantScope: bill.scope, period: bill.period },
      orderBy: { decisionOrdinal: "desc" }, select: { coverageState: true } }) : null;
    const billCovered = bill ? latestBill?.coverageState === "COMPLETE" : null;
    return { ok: missingModes.length === 0 && billCovered !== false, missingModes, billCovered };
  }, { timeout: 2000 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([check, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("readiness timeout")), 2500);
      timer.unref();
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
