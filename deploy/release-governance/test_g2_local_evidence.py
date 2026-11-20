"""S5-R3B A2/A6: G2_LOCAL_INDEPENDENT verifier. One valid producer bundle, one independent replay and a detached
signed approval PASS; every listed tampering, omission, skip, failure, self-approval or stale approval HOLDs.

Bundles are fabricated over a real git repository holding the bound files (no steps are executed here: the run
command itself is exercised by the offline evidence run). Signatures are real OpenSSH ed25519 signatures."""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest

import g2_local_evidence as g2

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
HAVE_SSH_KEYGEN = shutil.which("ssh-keygen") is not None


def sha(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def write_json(path, value):
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=1, sort_keys=True)
        handle.write("\n")


class Fixture:
    """A clean git checkout holding the real bound files, three signing identities and an allowed-signers text."""

    def __init__(self, root, src=None, keep=()):
        """src: an existing git checkout to complete (files named in `keep` are left as they are)."""
        self.root = root
        self.src = src or os.path.join(root, "src")
        for name, rel in g2.BOUND_FILES.items():
            if name in keep:
                continue
            os.makedirs(os.path.dirname(os.path.join(self.src, rel)), exist_ok=True)
            shutil.copyfile(os.path.join(REPO_ROOT, rel), os.path.join(self.src, rel))
        git = ["git", "-C", self.src, "-c", "user.email=t@example.invalid", "-c", "user.name=t"]
        if src is None:
            subprocess.run(["git", "init", "-q", self.src], check=True)
        subprocess.run(git + ["add", "-A"], check=True)
        subprocess.run(git + ["commit", "-q", "-m", "fixture"], check=True)
        self.head = g2.git(self.src, "rev-parse", "HEAD")
        self.tree = g2.git(self.src, "rev-parse", "HEAD^{tree}")
        with open(os.path.join(self.src, g2.TEST_MANIFEST_PATH)) as handle:
            self.test_manifest = json.load(handle)
        self.keys, lines = {}, []
        for name in ("producer", "replayer", "reviewer", "outsider"):
            key = os.path.join(root, name)
            subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", name, "-f", key], check=True)
            self.keys[name] = key
            with open(key + ".pub") as handle:
                kind, body = handle.read().split()[:2]
            if name != "outsider":
                lines.append(f"{name} {kind} {body}")
        self.allowed = "\n".join(lines)
        self.bundles = 0

    def bundle(self, role="PRODUCER", principal="producer", key=None, mutate=None, results_mutate=None, sign=True):
        self.bundles += 1
        out = os.path.join(self.root, f"bundle{self.bundles}")
        os.mkdir(out)
        run_id = f"{self.bundles:032x}"
        steps = []
        for spec in self.test_manifest["steps"]:
            steps.append({"id": spec["id"], "status": "PASS", "exit_code": 0, "ran": spec.get("min_tests", 0),
                          "failures": 0, "errors": 0, "skipped": 0, "checks_pass": spec.get("min_checks", 0),
                          "checks_fail": 0, "log_sha256": "a" * 64})
        results = {"schema": g2.EVIDENCE_SCHEMA, "commit": self.head, "run_id": run_id, "steps": steps,
                   "cleanup": {"status": "PASS", "leftovers": 0}, "secret_scan": {"status": "PASS", "hits": 0}}
        environment = {"schema": g2.EVIDENCE_SCHEMA, "run_id": run_id,
                       "images": {ref: {"id": image_id} for ref, image_id in self.test_manifest["pinned_images"].items()}}
        if results_mutate:
            results_mutate(results, environment)
        write_json(os.path.join(out, "TEST_RESULTS.json"), results)
        write_json(os.path.join(out, "ENVIRONMENT_PROVENANCE.json"), environment)
        for name in ("SANITIZED_RECEIPT.txt", "REPLAY_INSTRUCTIONS.md"):
            with open(os.path.join(out, name), "w") as handle:
                handle.write(name + "\n")
        manifest = {"schema": g2.EVIDENCE_SCHEMA, "repository": g2.REPOSITORY, "commit": self.head, "tree": self.tree,
                    "clean_checkout": True, "role": role, "principal": principal, "run_id": run_id,
                    "started_at": "2026-11-20T00:00:00Z", "finished_at": "2026-11-20T01:00:00Z", "completed": True,
                    "interrupted": False,
                    "bound_files": {n: sha(os.path.join(self.src, r)) for n, r in g2.BOUND_FILES.items()},
                    "bundle_files": {n: sha(os.path.join(out, n)) for n in g2.BUNDLE_FILES if n != "EVIDENCE_MANIFEST.json"}}
        if mutate:
            mutate(manifest)
        write_json(os.path.join(out, "EVIDENCE_MANIFEST.json"), manifest)
        self.reseal(out, key or self.keys[principal] if principal in self.keys else self.keys["producer"], sign)
        return out

    def reseal(self, out, key, sign=True):
        with open(os.path.join(out, g2.SUMS), "w") as handle:
            for name in g2.BUNDLE_FILES:
                handle.write(f"{sha(os.path.join(out, name))}  {name}\n")
        if sign:
            g2.ssh_sign(key, g2.NS_EVIDENCE, os.path.join(out, g2.SUMS))

    def approval(self, evidence, replay, reviewer="reviewer", key=None, **overrides):
        path = os.path.join(self.root, f"approval{self.bundles}-{len(os.listdir(self.root))}.json")
        doc = {"schema": g2.APPROVAL_SCHEMA, "repository": g2.REPOSITORY, "commit": self.head, "tree": self.tree,
               "evidence_sums_sha256": sha(os.path.join(evidence, g2.SUMS)),
               "replay_sums_sha256": sha(os.path.join(replay, g2.SUMS)), "producer_principal": "producer",
               "replay_principal": "replayer", "reviewer_principal": reviewer, "verdict": g2.APPROVAL_VERDICT,
               "scope": g2.APPROVAL_SCOPE, "reviewed_at": "2026-11-20T02:00:00Z"}
        doc.update(overrides)
        write_json(path, doc)
        g2.ssh_sign(key or self.keys.get(reviewer, self.keys["reviewer"]), g2.NS_APPROVAL, path)
        return path


@unittest.skipUnless(HAVE_SSH_KEYGEN, "ssh-keygen (OpenSSH >= 8) is required for G2_LOCAL_INDEPENDENT")
class G2LocalVerifierTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.f = Fixture(self.tmp.name)
        self.evidence = self.f.bundle()
        self.replay = self.f.bundle("REPLAY", "replayer")
        self.approval = self.f.approval(self.evidence, self.replay)

    def tearDown(self):
        self.tmp.cleanup()

    def verify(self, evidence=None, replay=None, approval=None, head=None, allowed=None):
        out = io.StringIO()
        argv = ["--source", self.f.src, "--expect-head", head or self.f.head, "--evidence", evidence or self.evidence,
                "--replay", replay or self.replay, "--approval", approval or self.approval,
                "--allowed-signers-text", self.f.allowed if allowed is None else allowed]
        with contextlib.redirect_stdout(out):
            code = g2.main(argv)
        lines = out.getvalue().splitlines()
        self.assertEqual(len(lines), 1, lines)
        return code, lines[0]

    def hold(self, reason, **kwargs):
        code, line = self.verify(**kwargs)
        self.assertEqual((code, line), (2, f"G2L_RESULT=HOLD_{reason}"))

    # --- positive -------------------------------------------------------------------------------------
    def test_producer_replay_and_detached_review_pass(self):
        self.assertEqual(self.verify(), (0, "G2L_RESULT=PASS"))

    def test_approve_command_writes_a_verifiable_approval_and_refuses_self_approval(self):
        allowed = os.path.join(self.tmp.name, "allowed")
        with open(allowed, "w") as handle:
            handle.write(self.f.allowed)
        path = os.path.join(self.tmp.name, "approved.json")
        base = ["approve", "--source", self.f.src, "--evidence", self.evidence, "--replay", self.replay,
                "--out", path, "--allowed-signers", allowed]
        with contextlib.redirect_stdout(io.StringIO()) as out:
            code = g2.main(base + ["--principal", "producer", "--signing-key", self.f.keys["producer"]])
        self.assertEqual(code, 2)
        self.assertIn("G2L_APPROVAL=NOT_WRITTEN_HOLD_G2L_SELF_APPROVAL", out.getvalue())
        self.assertFalse(os.path.exists(path))
        with contextlib.redirect_stdout(io.StringIO()):
            code = g2.main(base + ["--principal", "reviewer", "--signing-key", self.f.keys["reviewer"]])
        self.assertEqual(code, 0)
        self.assertEqual(self.verify(approval=path), (0, "G2L_RESULT=PASS"))

    # --- A6 mandatory negatives -----------------------------------------------------------------------
    def test_missing_bundle_or_receipt_file(self):
        self.hold("G2L_BUNDLE_MISSING", evidence=os.path.join(self.tmp.name, "absent"))
        os.remove(os.path.join(self.evidence, "SANITIZED_RECEIPT.txt"))
        self.hold("G2L_BUNDLE_INCOMPLETE")

    def test_altered_receipt_or_results(self):
        with open(os.path.join(self.evidence, "SANITIZED_RECEIPT.txt"), "a") as handle:
            handle.write("G2L_STEP_X=PASS\n")
        self.hold("G2L_BUNDLE_TAMPERED")

    def test_resealed_tampering_breaks_the_signature_or_the_approval(self):
        path = os.path.join(self.evidence, "TEST_RESULTS.json")
        with open(path) as handle:
            results = json.load(handle)
        results["steps"][0]["failures"] = 0
        results["steps"][0]["ran"] += 1
        write_json(path, results)
        self.hold("G2L_BUNDLE_TAMPERED")                       # manifest still names the old results hash
        manifest_path = os.path.join(self.evidence, "EVIDENCE_MANIFEST.json")
        with open(manifest_path) as handle:
            manifest = json.load(handle)
        manifest["bundle_files"]["TEST_RESULTS.json"] = sha(path)
        write_json(manifest_path, manifest)
        self.f.reseal(self.evidence, None, sign=False)          # sums recomputed, old signature kept
        self.hold("G2L_APPROVAL_OTHER_EVIDENCE")               # the approval names the earlier SHA256SUMS
        approval = self.f.approval(self.evidence, self.replay)
        self.hold("G2L_EVIDENCE_SIGNATURE", approval=approval)  # ...and the producer never signed the new sums

    def test_wrong_sha_and_wrong_tree(self):
        self.hold("G2L_OTHER_SHA", head="0" * 40)
        self.hold("G2L_OTHER_SHA", evidence=self.f.bundle(mutate=lambda m: m.update(commit="1" * 40)))
        self.hold("G2L_OTHER_TREE", evidence=self.f.bundle(mutate=lambda m: m.update(tree="2" * 40)))

    def test_wrong_auditor_wrapper_executor_or_manifest_hash(self):
        for name in ("auditor", "wrapper", "executor", "workflow", "test_manifest", "verifier"):
            bundle = self.f.bundle(mutate=lambda m, n=name: m["bound_files"].update({n: "0" * 64}))
            self.hold("G2L_FILE_HASH_" + name.upper(), evidence=bundle)

    def test_incomplete_manifest(self):
        self.hold("G2L_MANIFEST_INCOMPLETE", evidence=self.f.bundle(mutate=lambda m: m.pop("run_id")))
        self.hold("G2L_MANIFEST_INCOMPLETE", evidence=self.f.bundle(mutate=lambda m: m["bound_files"].pop("executor")))

    def test_omitted_required_test(self):
        bundle = self.f.bundle(results_mutate=lambda r, e: r["steps"].pop(3))
        self.hold("G2L_REQUIRED_TEST_MISSING", evidence=bundle)
        bundle = self.f.bundle(results_mutate=lambda r, e: r["steps"].append(dict(r["steps"][0], id="EXTRA")))
        self.hold("G2L_RESULTS_UNKNOWN_STEP", evidence=bundle)
        bundle = self.f.bundle(results_mutate=lambda r, e: r["steps"].append(dict(r["steps"][0])))
        self.hold("G2L_RESULTS_DUPLICATE_STEP", evidence=bundle)
        bundle = self.f.bundle(results_mutate=lambda r, e: r["steps"][0].update(ran=5))
        self.hold("G2L_TEST_COUNT_LOW", evidence=bundle)    # tests silently dropped from the suite

    def test_required_test_with_skip(self):
        for change in (dict(status="SKIPPED"), dict(status="BLOCKED"), dict(skipped=1)):
            bundle = self.f.bundle(results_mutate=lambda r, e, c=change: r["steps"][1].update(c))
            self.hold("G2L_REQUIRED_TEST_SKIPPED", evidence=bundle)

    def test_divergent_image(self):
        ref = next(iter(self.f.test_manifest["pinned_images"]))
        bundle = self.f.bundle(results_mutate=lambda r, e: e["images"][ref].update(id="sha256:" + "9" * 64))
        self.hold("G2L_IMAGE_MISMATCH", evidence=bundle)
        bundle = self.f.bundle(results_mutate=lambda r, e: e["images"].pop(ref))
        self.hold("G2L_IMAGE_MISMATCH", evidence=bundle)

    def test_missing_approval(self):
        self.hold("G2L_APPROVAL_MISSING", approval=os.path.join(self.tmp.name, "none.json"))
        os.remove(self.approval + ".sig")
        self.hold("G2L_APPROVAL_SIGNATURE")

    def test_approval_of_another_sha_or_other_evidence(self):
        self.hold("G2L_APPROVAL_OTHER_SHA", approval=self.f.approval(self.evidence, self.replay, commit="3" * 40))
        self.hold("G2L_APPROVAL_OTHER_SHA", approval=self.f.approval(self.evidence, self.replay, tree="4" * 40))
        other = self.f.bundle()
        self.hold("G2L_APPROVAL_OTHER_EVIDENCE", approval=self.f.approval(other, self.replay))
        self.hold("G2L_NOT_APPROVED", approval=self.f.approval(self.evidence, self.replay, verdict="REJECT"))
        self.hold("G2L_NOT_APPROVED", approval=self.f.approval(self.evidence, self.replay, scope="S5_ACTIVATION"))

    def test_self_approval_by_name_or_by_key(self):
        approval = self.f.approval(self.evidence, self.replay, reviewer="producer", key=self.f.keys["producer"])
        self.hold("G2L_SELF_APPROVAL", approval=approval)
        # the producer's key admitted a second time under the reviewer's name
        with open(self.f.keys["producer"] + ".pub") as handle:
            kind, body = handle.read().split()[:2]
        allowed = "\n".join(l for l in self.f.allowed.splitlines() if not l.startswith("reviewer ")) + f"\nreviewer {kind} {body}"
        approval = self.f.approval(self.evidence, self.replay, key=self.f.keys["producer"])
        self.hold("G2L_SELF_APPROVAL", approval=approval, allowed=allowed)

    def test_replay_must_be_a_distinct_producer_and_run(self):
        same = self.f.bundle("REPLAY", "producer")
        self.hold("G2L_REPLAY_NOT_INDEPENDENT", replay=same,
                  approval=self.f.approval(self.evidence, same, replay_principal="producer"))
        self.hold("G2L_ROLE_MISMATCH", replay=self.evidence, approval=self.f.approval(self.evidence, self.evidence))

    def test_failed_result(self):
        for change in (dict(status="FAIL"), dict(exit_code=1), dict(failures=1), dict(errors=2), dict(status="ERROR")):
            bundle = self.f.bundle(results_mutate=lambda r, e, c=change: r["steps"][0].update(c))
            self.hold("G2L_TEST_FAILED", evidence=bundle)
        bundle = self.f.bundle(results_mutate=lambda r, e: r["steps"][5].update(checks_fail=1))
        self.hold("G2L_TEST_FAILED", evidence=bundle)

    def test_interrupted_run(self):
        self.hold("G2L_RUN_INTERRUPTED", evidence=self.f.bundle(mutate=lambda m: m.update(interrupted=True)))
        self.hold("G2L_RUN_INTERRUPTED", evidence=self.f.bundle(mutate=lambda m: m.update(completed=False)))

    def test_unknown_schema(self):
        self.hold("G2L_SCHEMA_UNKNOWN", evidence=self.f.bundle(mutate=lambda m: m.update(schema="newsflux.g2-local-evidence/v2")))
        self.hold("G2L_SCHEMA_UNKNOWN", approval=self.f.approval(self.evidence, self.replay, schema="other/v1"))
        bundle = self.f.bundle(results_mutate=lambda r, e: r["steps"][0].update(status="PASSED"))
        self.hold("G2L_SCHEMA_UNKNOWN", evidence=bundle)

    # --- further isolation and signature negatives ------------------------------------------------------
    def test_cleanup_and_secret_scan_must_pass(self):
        self.hold("G2L_CLEANUP", evidence=self.f.bundle(results_mutate=lambda r, e: r["cleanup"].update(leftovers=1)))
        self.hold("G2L_SECRET_SCAN", evidence=self.f.bundle(results_mutate=lambda r, e: r["secret_scan"].update(hits=1)))

    def test_unexpected_file_in_bundle(self):
        with open(os.path.join(self.evidence, "extra.log"), "w") as handle:
            handle.write("x")
        self.hold("G2L_BUNDLE_UNEXPECTED_FILE")

    def test_no_admitted_signer_holds_after_integrity(self):
        self.hold("G2L_SIGNERS_NOT_ADMITTED", allowed="")

    def test_unsigned_or_outsider_signatures(self):
        unsigned = self.f.bundle(sign=False)
        self.hold("G2L_BUNDLE_INCOMPLETE", evidence=unsigned, approval=self.f.approval(unsigned, self.replay))
        outsider = self.f.bundle(key=self.f.keys["outsider"])
        self.hold("G2L_EVIDENCE_SIGNATURE", evidence=outsider, approval=self.f.approval(outsider, self.replay))
        approval = self.f.approval(self.evidence, self.replay, key=self.f.keys["outsider"])
        self.hold("G2L_APPROVAL_SIGNATURE", approval=approval)
        # an evidence signature presented as an approval signature (namespace binding)
        shutil.copyfile(os.path.join(self.evidence, g2.SUMS_SIG), self.approval + ".sig")
        self.hold("G2L_APPROVAL_SIGNATURE")

    def test_dirty_source_holds(self):
        with open(os.path.join(self.f.src, g2.BOUND_FILES["auditor"]), "a") as handle:
            handle.write("# local edit\n")
        self.hold("G2L_CHECKOUT_NOT_CLEAN")

    def test_usage_holds(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = g2.main(["--source", self.f.src])
        self.assertEqual((code, out.getvalue().strip()), (2, "G2L_RESULT=HOLD_G2L_USAGE"))
        self.hold("G2L_USAGE", head="not-a-sha")


class UnittestParserTests(unittest.TestCase):
    def test_counts(self):
        self.assertEqual(g2.parse_unittest("Ran 12 tests in 1.0s\n\nOK\n"),
                         {"ran": 12, "failures": 0, "errors": 0, "skipped": 0, "ok": True})
        self.assertEqual(g2.parse_unittest("Ran 3 tests in 1s\n\nOK (skipped=1)\n")["skipped"], 1)
        parsed = g2.parse_unittest("Ran 9 tests in 1s\n\nFAILED (failures=2, errors=1, skipped=3)\n")
        self.assertEqual((parsed["failures"], parsed["errors"], parsed["skipped"], parsed["ok"]), (2, 1, 3, False))
        self.assertFalse(g2.parse_unittest("Traceback ...\n")["ok"])

    def test_secret_patterns_catch_real_shapes_and_ignore_synthetic_bearers(self):
        import re
        samples = ["sk-" + "a1" * 12, "ghp_" + "A" * 24, "AKIA" + "B" * 16, "-----BEGIN OPENSSH PRIVATE KEY-----",
                   "Bearer " + "q" * 30]
        for sample in samples:
            self.assertTrue(any(re.search(p, sample) for p in g2.SECRET_PATTERNS), sample)
        self.assertFalse(any(re.search(p, "Bearer synthetic-chatgpt-bearer-not-a-key") for p in g2.SECRET_PATTERNS))


if __name__ == "__main__":
    unittest.main()
