"""Offline gate audit. Never opens secrets, sockets, databases or deploys."""
import argparse, json, pathlib, hashlib, sys
parser=argparse.ArgumentParser();parser.add_argument('--root',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parents[3]);parser.add_argument('--output',type=pathlib.Path);args=parser.parse_args();root=args.root.resolve();folder=root/'docs/prelaunch/launch-readiness';state=json.loads((folder/'READINESS_STATE.json').read_text());issues=[];seen=set()
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
    if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=evidence.get('sha256'):issues.append({'id':identity,'reason':'EVIDENCE_HASH_MISMATCH'});continue
    if evidence.get('scope') not in ['FORMAL_POLICY_SIGNOFF','REAL_CHANNEL','REAL_DEVICE','PRODUCTION_ENVIRONMENT','VERIFIED_IMPLEMENTATION']:issues.append({'id':identity,'reason':'INSUFFICIENT_EVIDENCE_SCOPE'})
required={f'OP-{n:02d}' for n in [3,4,5,7,8,9,10,11,12,13,14,15]}|{f'RV-{n:02d}' for n in range(1,8)}|{'EXT-01','EXT-02','EXT-03','ENG-01','ENG-02','ENG-03','QA-01','QA-02','OPS-01','REL-01'}
for missing in sorted(required-seen):issues.append({'id':missing,'reason':'REQUIRED_GATE_MISSING'})
result={'result':'NOT_READY' if issues else 'EVIDENCE_LINKS_COMPLETE_REQUIRES_SEMANTIC_REVIEW','release_authorized':False,'deploy_performed':False,'scope':'OFFLINE_GATE_AND_EVIDENCE_LINK_AUDIT_ONLY','baseline_candidate':state['baseline_candidate'],'open_count':len(issues),'issues':issues}
text=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
if args.output:args.output.write_text(text)
print(text,end='');sys.exit(2 if issues else 0)
