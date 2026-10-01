"""Offline gate audit. Never opens secrets, sockets, databases or deploys."""
import argparse, json, pathlib, hashlib, sys, re
parser=argparse.ArgumentParser();parser.add_argument('--root',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parents[3]);parser.add_argument('--output',type=pathlib.Path);args=parser.parse_args();root=args.root.resolve();folder=root/'docs/prelaunch/launch-readiness';state=json.loads((folder/'READINESS_STATE.json').read_text());issues=[];seen=set()
allowed_scopes = {**{f'OP-{n:02d}': {'FORMAL_POLICY_SIGNOFF'} for n in [3,4,5,7,8,9,10,11,12,13,14,15]},
    **{f'RV-{n:02d}': {'FORMAL_POLICY_SIGNOFF'} for n in range(1,8)},
    **{f'ENG-{n:02d}': {'VERIFIED_IMPLEMENTATION'} for n in range(1,4)},
    'EXT-01': {'REAL_CHANNEL'}, 'EXT-02': {'REAL_CHANNEL'}, 'EXT-03': {'PRODUCTION_ENVIRONMENT'},
    'QA-01': {'REAL_DEVICE'}, 'QA-02': {'REAL_CHANNEL'}, 'OPS-01': {'FORMAL_POLICY_SIGNOFF'}, 'REL-01': {'PRODUCTION_ENVIRONMENT'}}
working_candidate=state.get('working_candidate')
if not isinstance(working_candidate,str) or not re.fullmatch(r'[a-f0-9]{64}',working_candidate): issues.append({'id':'CANDIDATE','reason':'WORKING_CANDIDATE_REQUIRED'})
for gate in state['gates']:
    identity=gate['id']
    if identity in seen: issues.append({'id':identity,'reason':'DUPLICATE_GATE'})
    seen.add(identity)
    if gate['status']!='PASS': issues.append({'id':identity,'reason':gate['description']});continue
    evidence=gate.get('evidence')
    if not isinstance(evidence,dict):issues.append({'id':identity,'reason':'EVIDENCE_REQUIRED'});continue
    relative=pathlib.PurePosixPath(evidence.get('path',''))
    if not relative.parts or relative.is_absolute() or '..' in relative.parts:issues.append({'id':identity,'reason':'INVALID_EVIDENCE_PATH'});continue
    path=root/str(relative)
    if any(parent.is_symlink() for parent in [path,*path.parents] if parent != root and root in parent.parents):issues.append({'id':identity,'reason':'SYMLINK_EVIDENCE_PATH'});continue
    if root not in path.resolve().parents:issues.append({'id':identity,'reason':'EVIDENCE_OUTSIDE_ROOT'});continue
    if evidence.get('candidate_id')!=working_candidate:issues.append({'id':identity,'reason':'EVIDENCE_CANDIDATE_MISMATCH'});continue
    if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=evidence.get('sha256'):issues.append({'id':identity,'reason':'EVIDENCE_HASH_MISMATCH'});continue
    if evidence.get('scope') not in allowed_scopes.get(identity,set()):issues.append({'id':identity,'reason':'INSUFFICIENT_EVIDENCE_SCOPE'})
required={f'OP-{n:02d}' for n in [3,4,5,7,8,9,10,11,12,13,14,15]}|{f'RV-{n:02d}' for n in range(1,8)}|{'EXT-01','EXT-02','EXT-03','ENG-01','ENG-02','ENG-03','QA-01','QA-02','OPS-01','REL-01'}
for missing in sorted(required-seen):issues.append({'id':missing,'reason':'REQUIRED_GATE_MISSING'})
result={'result':'NOT_READY' if issues else 'EVIDENCE_LINKS_COMPLETE_REQUIRES_SEMANTIC_REVIEW','release_authorized':False,'deploy_performed':False,'scope':'OFFLINE_GATE_AND_EVIDENCE_LINK_AUDIT_ONLY','baseline_candidate':state['baseline_candidate'],'working_candidate':working_candidate,'open_count':len(issues),'issues':issues}
text=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
if args.output:args.output.write_text(text)
print(text,end='');sys.exit(2 if issues else 0)
