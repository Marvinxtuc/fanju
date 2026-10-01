#!/usr/bin/env python3
"""Read-only structural/evidence-link check; NOT code, legal, or release acceptance."""
from __future__ import annotations
import sys
sys.dont_write_bytecode = True
import argparse
import hashlib
import json
import re
from pathlib import Path
from verify_pack import safe_file, digest

STATUSES={'PASS','FAIL','NOT_RUN','BLOCKED_POLICY','BLOCKED_EXTERNAL','BLOCKED_ENVIRONMENT'}
IMPL={'IMPLEMENTED','PARTIAL','MISSING','BLOCKED_POLICY','BLOCKED_EXTERNAL','BLOCKED_ENVIRONMENT'}
TASK_STATUSES={'COMPLETED','BLOCKED','INCOMPLETE'}
HEX=re.compile(r'^[0-9a-f]{64}$')

def load(root: Path, name: str):
    return json.loads(safe_file(root,name).read_text('utf-8'))

def exact(rows, expected, label):
    ids=[r.get('id') for r in rows]
    if len(ids)!=len(expected) or set(ids)!=set(expected) or len(ids)!=len(set(ids)):
        raise ValueError(f'{label}: IDs missing/duplicate/unknown')

def validate(root: Path, pack: Path) -> tuple[list[str], dict[str, object]]:
    errors=[]
    stats={'scope':'STRUCTURE_AND_HASH_LINKS_ONLY','business_correctness_verified':False,'release_authorized':False}
    try:
        root=root.resolve(strict=True);pack=pack.resolve(strict=True)
        c=load(pack,'acceptance/HANDOFF_CONTRACT.json')
        for p in c['reports']+c['json_files']+c['other_required']:
            f=safe_file(root,p)
            if f.stat().st_size==0:raise ValueError(f'Empty required file: {p}')
        for p in root.rglob('*'):
            if p.is_symlink():raise ValueError('Symlink rejected in final delivery')
        fm=load(root,'docs/prelaunch/FILE_MANIFEST.json')
        entries=fm['files']
        if not entries:raise ValueError('Empty file manifest')
        indexed={}
        for e in entries:
            p=e['path']
            if p in indexed:raise ValueError('Duplicate file manifest path')
            f=safe_file(root,p)
            if not isinstance(e.get('sha256'),str) or not HEX.fullmatch(e['sha256']):raise ValueError('Bad file digest')
            if digest(f)!=e['sha256'] or f.stat().st_size!=e['bytes']:raise ValueError(f'File hash/size mismatch: {p}')
            indexed[p]=e
        excludes={'docs/prelaunch/FILE_MANIFEST.json','REVIEW_SHA256SUMS'}
        actual={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}-excludes
        if actual != set(indexed):raise ValueError('Final file manifest incomplete or extra entries')
        m=load(root,'docs/prelaunch/RELEASE_CANDIDATE_MANIFEST.json')
        if m.get('pack_id')!=c['pack_id'] or m.get('delivery_status') not in c['allowed_delivery_statuses']:
            raise ValueError('Invalid/unfinished delivery status')
        for k in ['production_authorized','real_money_executed','production_deployed','git_committed_in_task','git_pushed']:
            if m.get(k) is not False:raise ValueError(f'{k} must remain false under this authorization')
        if m.get('policy_status')!='REBASED_DRAFT' or m.get('policy_bundle_sha256')!=c['source_policy_bundle_sha256']:
            raise ValueError('Frozen source policy/activation changed')
        source=[{'path':p[len('source/'):],'sha256':e['sha256']} for p,e in indexed.items() if p.startswith('source/')]
        source.sort(key=lambda e:e['path'])
        if not source:raise ValueError('Missing final source snapshot')
        computed=hashlib.sha256(json.dumps(source,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')).hexdigest()
        if m.get('candidate_id')!=computed or m.get('source_snapshot_sha256')!=computed:
            raise ValueError('Source snapshot/candidate mismatch')
        candidate=computed
        if not isinstance(m.get('base_head'),str) or not re.fullmatch(r'[0-9a-f]{40}',m['base_head']):
            raise ValueError('Missing actual base HEAD')
        b=load(root,'docs/prelaunch/BLOCKER_REGISTER.json')['items']
        bids=[x['id'] for x in b]
        if len(bids)!=len(set(bids)):raise ValueError('Duplicate blocker IDs')
        blocker_ids=set(bids)
        for x in b:
            if x.get('kind') not in {'POLICY','EXTERNAL','ENVIRONMENT','ENGINEERING'} or x.get('state') not in {'OPEN','CLOSED'}:
                raise ValueError('Invalid blocker classification')
            for k in ['description','owner_role','required_input','handling']:
                if not isinstance(x.get(k),str) or not x[k].strip():raise ValueError('Incomplete blocker record')
        ei=load(root,'docs/prelaunch/EVIDENCE_INDEX.json')
        if ei.get('candidate_id')!=candidate:raise ValueError('Evidence index from different candidate')
        artifacts={}
        for a in ei['artifacts']:
            p=a['path'];f=safe_file(root,p)
            if p in artifacts:raise ValueError('Duplicate evidence artifact')
            if a['sha256']!=digest(f) or a['bytes']!=f.stat().st_size:raise ValueError('Evidence artifact hash mismatch')
            artifacts[p]=a
        runs={}
        for run in ei['runs']:
            rid=run['id']
            if rid in runs:raise ValueError('Duplicate run IDs')
            for k in ['category','command','cwd','started_at','finished_at']:
                if not isinstance(run.get(k),str) or not run[k]:raise ValueError('Incomplete execution record')
            if run.get('candidate_id')!=candidate:raise ValueError('Run tied to different final source')
            if run.get('runner') not in {'native','adapter','manual'}:raise ValueError('Runner identity missing')
            if type(run.get('exit_code')) is not int:raise ValueError('Missing actual exit code')
            if not isinstance(run.get('toolchain'),dict) or not run['toolchain']:raise ValueError('Missing toolchain record')
            if not run.get('artifact_paths') or any(p not in artifacts for p in run['artifact_paths']):
                raise ValueError('Run lacks hash-linked raw artifact')
            runs[rid]=run
        def refs(row, must_pass=False):
            if any(x not in blocker_ids for x in row.get('blocker_ids',[])):raise ValueError('Unknown blocker reference')
            ev=row.get('evidence_ids',[])
            if any(x not in runs for x in ev):raise ValueError('Unknown evidence run')
            if must_pass and (not ev or any(runs[x]['exit_code']!=0 for x in ev)):
                raise ValueError('PASS has no successful linked execution')
        cov=load(root,'docs/prelaunch/COVERAGE_LEDGER.json')
        if cov.get('candidate_id')!=candidate:raise ValueError('Coverage from different candidate')
        exact(cov['rules'],c['expected_rule_ids'],'rules')
        exact(cov['scenarios'],c['expected_scenario_ids'],'scenarios')
        for r in cov['rules']:
            if r.get('implementation_status') not in IMPL or r.get('verification_status') not in STATUSES:
                raise ValueError('Unassessed or invalid rule result')
            refs(r,r['verification_status']=='PASS')
            if r['implementation_status']=='IMPLEMENTED' and not r.get('code_refs'):raise ValueError('Implementation lacks code reference')
            if 'BLOCKED' in r['implementation_status']+r['verification_status'] and not r.get('blocker_ids'):
                raise ValueError('Blocked rule lacks blocker')
        for s in cov['scenarios']:
            if s.get('status') not in STATUSES or s.get('candidate_id')!=candidate:raise ValueError('Invalid scenario status/candidate')
            refs(s,s['status']=='PASS')
            if s['status'].startswith('BLOCKED') and not s.get('blocker_ids'):raise ValueError('Blocked scenario lacks blocker')
        ts=load(root,'docs/prelaunch/TASK_STATUS.json')
        if ts.get('candidate_id')!=candidate:raise ValueError('Task status different candidate')
        exact(ts['tasks'],c['expected_task_ids'],'tasks')
        for t in ts['tasks']:
            if t.get('status') not in TASK_STATUSES:raise ValueError('Unfinished task classification')
            refs(t,t['status']=='COMPLETED')
            if t['status']=='BLOCKED' and not t.get('blocker_ids'):raise ValueError('Blocked task without reason')
        if not all(x in m.get('self_review_rounds',[]) for x in ['R1','R2','R3','R4']):
            raise ValueError('Self-review rounds not all documented')
        if m['delivery_status']=='RC_READY_FOR_INDEPENDENT_REVIEW':
            if any(x['state']=='OPEN' and x['kind'] in {'POLICY','ENGINEERING'} for x in b):
                raise ValueError('Full RC claimed with open essential policy/engineering blockers')
            if m.get('critical_high_engineering_findings'):raise ValueError('RC retains critical/high internal findings')
            if any(t['status']!='COMPLETED' for t in ts['tasks']):raise ValueError('Full RC has incomplete/blocked tasks')
            if any(s['status'] not in {'PASS','BLOCKED_EXTERNAL','BLOCKED_ENVIRONMENT'} for s in cov['scenarios']):
                raise ValueError('Full RC with unresolved local scenario')
        stats.update({'files_checked':len(indexed),'rules':len(cov['rules']),'scenarios':len(cov['scenarios']),
                      'tasks':len(ts['tasks']),'linked_runs':len(runs),'candidate_id':candidate,'delivery_status':m['delivery_status']})
    except (OSError,ValueError,KeyError,TypeError,json.JSONDecodeError) as exc:
        errors.append(str(exc))
    return errors,stats

def main()->int:
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',required=True,type=Path,help='Unpacked FANJU_PRELAUNCH_REVIEW directory')
    p.add_argument('--pack',type=Path,default=Path(__file__).resolve().parents[1])
    a=p.parse_args();errors,stats=validate(a.root,a.pack)
    print(json.dumps({'result':'STRUCTURE_ONLY_PASS' if not errors else 'STRUCTURE_CHECK_FAIL','stats':stats,'errors':errors},ensure_ascii=False,indent=2))
    return 0 if not errors else 2
if __name__=='__main__':raise SystemExit(main())
