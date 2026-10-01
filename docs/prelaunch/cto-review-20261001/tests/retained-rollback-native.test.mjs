import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {dirname} from 'node:path';import {createRequire} from 'node:module';
import {root,verifyOwnedEnvironment} from '../../../../scripts/prelaunch-owned-env.mjs';
test('retained formal history rejects structural rollback before any guard or table is removed',async()=>{
 const {runtime}=await verifyOwnedEnvironment(dirname(process.env.PRELAUNCH_ENV_FILE),'empty'),{Pool}=createRequire(root+'/services/api/package.json')('pg'),pool=new Pool({connectionString:runtime.database_url}),client=await pool.connect();
 try{
  const count=async()=>Number((await client.query('SELECT count(*) AS n FROM "V11RuntimePolicyBinding"')).rows[0].n),before=await count();assert.ok(before>0);
  await assert.rejects(client.query(readFileSync(root+'/docs/prelaunch/cto-review-20261001/migrations/rollback-unused-formal-assembly.sql','utf8')),/Retained formal history exists/);
  await client.query('ROLLBACK');assert.equal(await count(),before);
  assert.equal(Number((await client.query("SELECT count(*) AS n FROM pg_trigger WHERE tgname='v11_formal_audit_history_guard' AND NOT tgisinternal")).rows[0].n),1);
 }finally{client.release();await pool.end();}
});
