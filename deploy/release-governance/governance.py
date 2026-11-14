"""Offline release evidence validator and isolated transition model.

No Docker or production operation is provided. Inputs are evidence supplied by
an operator and must be independently collected and authenticated.
"""
import hashlib
import json
from pathlib import Path
import re
import sys
import threading


class GateError(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise GateError(code)


def validate(manifest, ordered_files, effective, protected):
    try:
        require(re.fullmatch(r'[a-f0-9]{40}', manifest['approved_sha']) is not None, 'INVALID_SHA')
        for key in ('candidate_image', 'previous_image'):
            require(re.fullmatch(r'sha256:[a-f0-9]{64}', manifest[key]) is not None, 'INVALID_IMAGE')
        require(manifest['candidate_image'] != manifest['previous_image'], 'SAME_IMAGE')
        items = manifest['compose_files']
        require(isinstance(items, list) and len(items) >= 2, 'COMPOSE_ORDER')
        expected = [Path(item['path']) for item in items]
        require(all(p.is_absolute() for p in expected) and len(set(expected)) == len(expected), 'COMPOSE_PATH')
        require(list(map(Path, ordered_files)) == expected, 'COMPOSE_ORDER')
        for item, path in zip(items, expected):
            require(path.is_file() and not path.is_symlink(), 'COMPOSE_FILE')
            require(hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256'], 'COMPOSE_HASH')
        rollback = Path(manifest['rollback_file'])
        require(rollback.is_absolute() and rollback.is_file() and not rollback.is_symlink(), 'ROLLBACK_MISSING')
        require(hashlib.sha256(rollback.read_bytes()).hexdigest() == manifest['rollback_sha256'], 'ROLLBACK_HASH')
        require(protected == manifest['protected_containers'] and bool(protected), 'PROTECTED_DRIFT')
        service = effective['services']['summary-api']
        require(service['image'] == manifest['candidate_image'], 'IMAGE_MISMATCH')
        require(not service.get('ports'), 'PUBLISHED_PORT')
        for key in ('NEWSFLUX_AI_INFERENCE_ENABLED','NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER', 'NEWSFLUX_AI_ALLOW_PAID_INFERENCE','NEWSFLUX_AI_ENABLE_S5_MISTRAL_FALLBACK'):
            require(str(service['environment'].get(key, '')).lower() == 'false', 'POLICY_NOT_DISABLED')
        require(set(service['networks']) == set(manifest['summary_networks']) and bool(manifest['summary_networks']), 'NETWORK_MISMATCH')
        require({item['target'] for item in service['volumes']} == set(manifest['summary_mounts']) and bool(manifest['summary_mounts']), 'MOUNT_MISMATCH')
    except (KeyError, TypeError, OSError, ValueError) as exc:
        if isinstance(exc, GateError): raise
        raise GateError('INVALID_EVIDENCE') from None


class SimulatedRelease:
    """In-memory rehearsal only; thread lock is not a cross-process deployment lock."""
    def __init__(self, manifest, state):
        self.manifest, self.state = manifest, state
        self._lock = threading.Lock()

    def transition(self, source, target):
        with self._lock:
            require(all(self.state.get(k) == v for k,v in self.manifest['protected_containers'].items()), 'PROTECTED_DRIFT')
            current = self.state.get('summary-api')
            require(current in (source, target), 'SUMMARY_DRIFT')
            if current == source: self.state['summary-api'] = target

    def promote(self):
        self.transition(self.manifest['previous_image'], self.manifest['candidate_image'])

    def rollback(self):
        self.transition(self.manifest['candidate_image'], self.manifest['previous_image'])


def main():
    # Offline evidence only; never print supplied configuration or exception text.
    if len(sys.argv) != 4:
        print('VALIDATION=BLOCKED_USAGE'); return 2
    try:
        manifest, effective, protected = (json.loads(Path(p).read_text()) for p in sys.argv[1:])
        validate(manifest, [item['path'] for item in manifest['compose_files']], effective, protected)
    except (GateError, ValueError, OSError, KeyError, TypeError):
        print('VALIDATION=BLOCKED'); return 1
    print('OFFLINE_EVIDENCE=PASS LIVE_RUNTIME=NOT_VERIFIED DEPLOY=NOT_IMPLEMENTED'); return 0


if __name__ == '__main__':
    sys.exit(main())
