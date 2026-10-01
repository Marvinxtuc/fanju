import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {root,createOwnedDatabase,verifyOwnedEnvironment,childEnvironment} from '/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/scripts/prelaunch-owned-env.mjs';
import {captureCandidate} from '/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/scripts/prelaunch-candidate-hash.mjs';
const {runtime}=await createOwnedDatabase('/tmp/fanju-prelaunch-20261001-b48140fda0c1','restore',{fresh:true});
await verifyOwnedEnvironment('/tmp/fanju-prelaunch-20261001-b48140fda0c1','restore');
await new Promise((resolve,reject)=>{const child=spawn('pnpm',['exec','prisma','migrate','deploy'],{cwd:root,env:childEnvironment(runtime),stdio:['ignore','ignore','ignore']});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Owned migration deploy failed')));});
const require=createRequire(root+'/services/api/package.json'),{Client}=require('pg'),db=new Client({connectionString:runtime.database_url});await db.connect();
const id='snapshot_rehearsal_'+randomUUID(),openid='mock_'+id;
try{
 await db.query('INSERT INTO "User" (id,"wechatOpenid","updatedAt") VALUES ($1,$2,now())',[id,openid]);
 await db.query('BEGIN');await db.query('ALTER TABLE "V11BillComparisonPage" DROP COLUMN "paymentQueryRefs", DROP COLUMN "refundQueryRefs"');await db.query('DROP TABLE "V11BillComparisonPage"');await db.query('DROP TABLE "V11BillComparisonSnapshot"');await db.query('DROP FUNCTION "v11_bill_snapshot_immutable"()');await db.query('COMMIT');
 const removed=await db.query(`SELECT to_regclass('"V11BillComparisonSnapshot"') IS NULL AS absent`);
 const kept=await db.query('SELECT count(*)::integer AS count FROM "User" WHERE id=$1 AND "wechatOpenid"=$2',[id,openid]);
 if(!removed.rows[0].absent||kept.rows[0].count!==1)throw Error('Rollback scope verification failed');
 await db.query(readFileSync(root+'/prisma/migrations/20261001060000_v11_bill_comparison_snapshot/migration.sql','utf8'));
 await db.query(readFileSync(root+'/prisma/migrations/20261001070000_v11_bill_comparison_page/migration.sql','utf8'));await db.query(readFileSync(root+'/prisma/migrations/20261001080000_v11_bill_page_query_refs/migration.sql','utf8'));
 const rebuilt=await db.query(`SELECT to_regclass('"V11BillComparisonSnapshot"') IS NOT NULL AS present`);if(!rebuilt.rows[0].present)throw Error('Rebuild failed');
 const columns=await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='V11BillComparisonPage' AND column_name IN ('paymentQueryRefs','refundQueryRefs')");const trigger=await db.query("SELECT 1 FROM pg_trigger WHERE tgname='v11_bill_page_no_update' AND NOT tgisinternal");if(columns.rowCount!==2||trigger.rowCount!==1)throw Error('Page schema rebuild evidence missing');
 await db.query('DELETE FROM "User" WHERE id=$1 AND "wechatOpenid"=$2',[id,openid]);
 const report={status:'PASS_ENGINEERING_ONLY',candidate:captureCandidate(root).candidate_id,environment:'FRESH_OWNED_RESTORE_GENERATION',migrations:['20261001060000_v11_bill_comparison_snapshot','20261001070000_v11_bill_comparison_page','20261001080000_v11_bill_page_query_refs'],up:true,down:true,rebuild:true,existing_synthetic_user_preserved:true,page_query_columns_restored:true,page_immutable_trigger_restored:true,production_changed:false,releaseAuthorized:false,scriptSha256:createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex')};
 writeFileSync(root+'/docs/prelaunch/launch-readiness/L04_BILL_PAGE_MIGRATION.json',JSON.stringify(report,null,2)+'\n');console.log('snapshot and page migrations up/down/rebuild: PASS; original synthetic user preserved');
}finally{await db.end();}
