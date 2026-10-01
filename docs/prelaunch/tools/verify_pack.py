#!/usr/bin/env python3
"""Read-only package integrity check. Does not run app tests or authorize release."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path, PurePosixPath

PINNED_BUNDLE = "1fcd70ea51b9776f819c9c9ada9e1611408a57b79ced56325226f8d5ae58f1a0"
PINNED_SOURCE = "0268f125663f3a31f9ebb0c8c49870bb2f3df9d47776e2c54439f162b1508743"

def digest(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()

def safe_file(root: Path, rel: str) -> Path:
    if not isinstance(rel, str) or not rel or "\\" in rel:
        raise ValueError("Invalid path")
    path = PurePosixPath(rel)
    if not path.parts or path.is_absolute() or ".." in path.parts or ":" in path.parts[0]:
        raise ValueError("Unsafe path")
    p = root.joinpath(*path.parts)
    cursor = root
    for part in path.parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValueError("Symlink rejected")
    if not p.resolve().is_relative_to(root.resolve()) or not p.is_file():
        raise ValueError("Missing/outside file")
    return p

def verify_sums(root: Path, text: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        m = re.fullmatch(r"([0-9a-f]{64})  (.+)", line)
        if not m:
            raise ValueError(f"Invalid checksum line {number}")
        expected, rel = m.groups()
        if rel in result:
            raise ValueError("Duplicate checksum path")
        p = safe_file(root, rel)
        if digest(p) != expected:
            raise ValueError(f"Digest mismatch: {rel}")
        result[rel] = expected
    if not result:
        raise ValueError("Empty checksum list")
    return result

def validate(root: Path) -> tuple[list[str], dict[str, object]]:
    errors: list[str] = []
    stats: dict[str, object] = {"scope": "PACKAGE_INTEGRITY_ONLY", "app_tests_executed": 0}
    try:
        root = root.resolve(strict=True)
        checks = verify_sums(root, safe_file(root, "SHA256SUMS").read_text("utf-8"))
        actual = set()
        for f in root.rglob("*"):
            if f.is_symlink():
                raise ValueError("Symlink in pack")
            if f.is_file() and f.relative_to(root).as_posix() != "SHA256SUMS":
                actual.add(f.relative_to(root).as_posix())
        if actual != set(checks):
            raise ValueError("Unlisted/missing pack files")
        stats["outer_files_checked"] = len(checks)
        policy_root = root / "inputs/policy_v1_1"
        inner = safe_file(policy_root, "docs/policy/SHA256SUMS_V1_1.txt")
        inner_checks = verify_sums(policy_root, inner.read_text("utf-8"))
        if len(inner_checks) != 15:
            raise ValueError("V1.1 checksum count differs")
        m = json.loads(safe_file(policy_root, "docs/policy/POLICY_V1_1_BUNDLE_MANIFEST.json").read_text("utf-8"))
        payload = m["bundle_payload"]
        calculated = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        if calculated != PINNED_BUNDLE or calculated != m["bundle_sha256"]:
            raise ValueError("V1.1 bundle digest mismatch")
        if m["eligibility"] != "NOT_ACTIVATABLE" or payload["document_status"] != "REBASED_DRAFT":
            raise ValueError("Frozen draft eligibility changed")
        docs = payload["documents"]
        if len(docs) != 14 or len({d['path'] for d in docs}) != 14:
            raise ValueError("V1.1 document set mismatch")
        for d in docs:
            if digest(safe_file(policy_root, d['path'])) != d['sha256']:
                raise ValueError("V1.1 manifest member mismatch")
        index = json.loads(safe_file(policy_root, "docs/policy/TRACEABILITY_INDEX.json").read_text("utf-8"))
        if len(index['rules']) != 104 or len({r['id'] for r in index['rules']}) != 104:
            raise ValueError("Source rule IDs mismatch")
        scenario_keys = ['baseline_acceptance_scenarios','supplemental_scenarios','decision_acceptance_scenarios']
        counts = [len(index[k]) for k in scenario_keys]
        if counts != [64, 12, 15]:
            raise ValueError("Source scenario count mismatch")
        expected_ops = {'CLOSED': 3, 'PARTIALLY_CLOSED': 4, 'OPEN': 8}
        if dict(Counter(x['status'] for x in index['open_decisions'])) != expected_ops:
            raise ValueError("Source OP states changed")
        if len(index['special_reviews']) != 7 or any(x['status'] != 'REVIEW_REQUIRED' for x in index['special_reviews']):
            raise ValueError("Source RV states changed")
        source_file = safe_file(policy_root, 'docs/policy/sources/FJ_DR01_DR02_DECISION_FREEZE_V1_1_INPUT.md')
        if digest(source_file) != PINNED_SOURCE:
            raise ValueError("15-decision source bytes changed")
        legacy_root = root / 'inputs/history/policy_v1_0_fixture'
        legacy = verify_sums(legacy_root, safe_file(legacy_root, 'SHA256SUMS').read_text('utf-8'))
        if len(legacy) != 5:
            raise ValueError('Legacy fixture count mismatch')
        tasks = json.loads(safe_file(root, 'master/TASK_CATALOG.json').read_text('utf-8'))['tasks']
        if {t['id'] for t in tasks} != {f'E{x:02}' for x in range(24)} or len(tasks) != 24:
            raise ValueError('Task set mismatch')
        known = {t['id'] for t in tasks}
        for t in tasks:
            safe_file(root, t['file'])
            if any(d not in known for d in t['dependencies']):
                raise ValueError('Unknown task dependency')
        graph = {t['id']:t['dependencies'] for t in tasks}
        active, done = set(), set()
        def visit(tid: str) -> None:
            if tid in active: raise ValueError('Task dependency cycle')
            if tid in done: return
            active.add(tid)
            for dep in graph[tid]: visit(dep)
            active.remove(tid); done.add(tid)
        for tid in graph: visit(tid)
        stats.update({'v1_1_checksum_files':15,'v1_1_manifest_files':14,'rules':104,
                      'source_scenarios':91,'frozen_decisions':15,'legacy_fixture_files':5,
                      'engineering_tasks':24,'bundle_sha256':calculated})
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        errors.append(str(exc))
    return errors, stats

def main() -> int:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args=parser.parse_args()
    errors,stats=validate(args.root)
    print(json.dumps({'result':'PACKAGE_INTEGRITY_PASS' if not errors else 'PACKAGE_INTEGRITY_FAIL',
                      'stats':stats,'errors':errors,
                      'release_authorized':False},ensure_ascii=False,indent=2))
    return 0 if not errors else 2
if __name__=='__main__':
    raise SystemExit(main())
