# G2_LOCAL_INDEPENDENT replay (commit d6dfa2c4eeb858cfba2f7af500ef8d2a37e32884, tree 65f58e65c5a8f97765482c39c42ad7f1e4d4a89b)

Replay must be done by a different producer (a different principal and signing key) in a disposable lab with an
exclusive Docker daemon (no other containers, networks or volumes). The commands below make no production
change, use synthetic data only and send nothing to any inference provider.

1. git clone https://github.com/jfsdias/NewsFlux.git src && git -C src checkout --detach d6dfa2c4eeb858cfba2f7af500ef8d2a37e32884
2. test "$(git -C src rev-parse HEAD^{tree})" = 65f58e65c5a8f97765482c39c42ad7f1e4d4a89b
3. python3 src/deploy/release-governance/g2_local_evidence.py run --source src --out replay-bundle \
     --logs replay-logs --role REPLAY --principal <your-principal> --signing-key <your-ssh-key> [--python-bin <venv>/bin/python3]
4. A reviewer who produced neither bundle checks both and signs the approval:
   python3 src/deploy/release-governance/g2_local_evidence.py approve --source src --evidence <producer-bundle> \
     --replay replay-bundle --out approval.json --principal <reviewer> --signing-key <reviewer-key> \
     --allowed-signers <file>
5. Nothing here admits the mode for a privileged run: the PM admits signers in s5-r3-omv-readonly-run.sh.
