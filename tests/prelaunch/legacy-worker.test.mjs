import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { verifyOwnedEnvironment, childEnvironment, root } from '../../scripts/prelaunch-owned-env.mjs';

test('legacy worker preserves a newer domain job and executes a legacy inbox job in the same durable queue', { timeout: 30_000 }, async () => {
  const runtimePath = process.env.PRELAUNCH_ENV_FILE;
  assert.ok(runtimePath, 'Owned synthetic runtime must be supplied');
  const { runtime } = await verifyOwnedEnvironment(dirname(runtimePath));
  const consumerRoot = realpathSync(process.env.PRELAUNCH_COMPAT_WORKER_ROOT ?? '');
  assert.ok(consumerRoot.startsWith(runtime.scratch + '/'), 'Legacy consumer must come from the owned compatibility copy');
  const { Pool } = createRequire(resolve(root, 'services/api/package.json'))('pg');
  const pool = new Pool({ connectionString: runtime.database_url, connectionTimeoutMillis: 5000, max: 1 });
  const id = `prelaunch_compat_${randomUUID().replaceAll('-', '')}`;
  const userId = `${id}_user`, noticeId = `${id}_notice`, futureJobId = `${id}_future`, legacyJobId = `${id}_legacy`, refundJobId = `${id}_refundjob`, refundId = `${id}_refund`, receiptId = `${id}_receipt`;
  let beforeV11;
  try {
    await pool.query('INSERT INTO "User" (id,"wechatOpenid","updatedAt") VALUES ($1,$2,clock_timestamp())', [userId, `mock_${id}`]);
    await pool.query('INSERT INTO "Notification" (id,"businessKey","userId",type,"updatedAt") VALUES ($1,$2,$3,$4,clock_timestamp())', [noticeId, `${id}:notice`, userId, 'SIMULATION_WORKER_COMPAT']);
    await pool.query('INSERT INTO "ChannelReceipt" (id,channel,"merchantScope","channelTradeNo","merchantOrderNo","amountCents","evidenceHash","verifiedAt","paidAt") VALUES ($1,$2,$3,$4,$5,10600,$6,clock_timestamp(),clock_timestamp())',[receiptId,'mock','mock-local',`${id}_trade`,`${id}_merchant_order`,'a'.repeat(64)]);
    await pool.query('INSERT INTO "V11FundComponent" (id,"receiptId",kind,"originalCents") VALUES ($1,$3,\'F\',600),($2,$3,\'D\',10000)',[`${id}_F`,`${id}_D`,receiptId]);
    await pool.query('INSERT INTO "V11RefundInstruction" (id,"receiptId","businessKey","merchantRefundNo","serviceFeeCents","depositCents","totalCents","originalTradeNo","updatedAt") VALUES ($1,$2,$3,$4,600,10000,10600,$5,clock_timestamp())',[refundId,receiptId,`${id}:refund`,`${id}_merchant`,`${id}_trade`]);
    beforeV11=(await pool.query('SELECT to_jsonb(r) AS value FROM "V11RefundInstruction" r WHERE id=$1',[refundId])).rows[0].value;
    for (const [jobId, kind, refId] of [[futureJobId, 'V11_COMPAT_SENTINEL', id], [legacyJobId, 'DELIVER_INBOX', noticeId], [refundJobId, 'V11_REFUND', refundId]]) {
      await pool.query('INSERT INTO "DurableJob" (id,kind,"businessKey","refId","runAt","updatedAt") VALUES ($1,$2,$3,$4,$5,clock_timestamp())', [jobId, kind, `${id}:${kind}`, refId, new Date(0)]);
    }
    const result = await new Promise((resolveExit, reject) => {
      const child = spawn(process.execPath, ['dist/worker.js', '--once'], {
        cwd: resolve(consumerRoot, 'services/api'), env: { ...childEnvironment(runtime), RELEASE_VERSION: 'SIMULATION-legacy-compat' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
      child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); resolveExit({ code, stdout, stderr }); });
    });
    assert.equal(result.code, 0, `Packaged legacy worker failed: ${result.stderr}`);
    const jobs = (await pool.query('SELECT id,state,attempts,generation,"leaseOwner" FROM "DurableJob" WHERE id=ANY($1::text[])', [[futureJobId, legacyJobId, refundJobId]])).rows;
    const future = jobs.find(job => job.id === futureJobId), legacy = jobs.find(job => job.id === legacyJobId);
    assert.equal(future.state, 'READY'); assert.equal(future.attempts, 0); assert.equal(future.generation, 0); assert.equal(future.leaseOwner, null);
    const newRefund=jobs.find(job=>job.id===refundJobId);
    assert.equal(newRefund.state,'READY');assert.equal(newRefund.attempts,0);assert.equal(newRefund.generation,0);assert.equal(newRefund.leaseOwner,null);
    assert.deepEqual((await pool.query('SELECT to_jsonb(r) AS value FROM "V11RefundInstruction" r WHERE id=$1',[refundId])).rows[0].value,beforeV11);
    assert.deepEqual((await pool.query('SELECT kind,"originalCents",version FROM "V11FundComponent" WHERE "receiptId"=$1 ORDER BY kind',[receiptId])).rows,[{kind:'D',originalCents:10000,version:0},{kind:'F',originalCents:600,version:0}]);
    assert.equal(legacy.state, 'DONE'); assert.equal(legacy.attempts, 1);
    assert.equal((await pool.query('SELECT status FROM "Notification" WHERE id=$1', [noticeId])).rows[0].status, 'SENT');
  } finally {
    // The selected rows belong only to this test; no shared reset/drop or general cleanup occurs.
    try {
      await verifyOwnedEnvironment(dirname(runtimePath));
      await pool.query('DELETE FROM "DurableJob" WHERE id=ANY($1::text[])', [[futureJobId, legacyJobId, refundJobId]]);
      await pool.query('DELETE FROM "V11RefundInstruction" WHERE id=$1',[refundId]);
      await pool.query('DELETE FROM "V11FundComponent" WHERE "receiptId"=$1',[receiptId]);
      await pool.query('DELETE FROM "ChannelReceipt" WHERE id=$1',[receiptId]);
      await pool.query('DELETE FROM "Notification" WHERE id=$1', [noticeId]);
      await pool.query('DELETE FROM "User" WHERE id=$1', [userId]);
    } finally { await pool.end(); }
  }
});
