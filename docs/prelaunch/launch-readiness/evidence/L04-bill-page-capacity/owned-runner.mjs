import {spawn} from 'node:child_process';
import {root,verifyOwnedEnvironment,childEnvironment} from '/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/scripts/prelaunch-owned-env.mjs';
const {runtime}=await verifyOwnedEnvironment('/tmp/fanju-prelaunch-20261001-b48140fda0c1','restore');
const child=spawn(process.execPath,['/tmp/fanju-prelaunch-resume-drafts/bill-page-capacity.mjs'],{cwd:root,env:{...childEnvironment(runtime),PRELAUNCH_SOURCE_ROOT:root},stdio:'inherit'});
child.once('exit',code=>process.exitCode=code??1);
