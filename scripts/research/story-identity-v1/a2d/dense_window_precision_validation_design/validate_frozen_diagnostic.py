"""Reopen frozen D2G0 outputs and independently verify against pinned inputs."""
import hashlib,json,sys
from pathlib import Path
from validate_diagnostic import independently_validate
import diagnose_private_evidence as source

def verify(target):
 target=Path(target).resolve()
 if not target.is_relative_to(source.OUTPUT.resolve()) or target.stat().st_mode&0o777!=0o700:raise ValueError('TARGET')
 with source.firewall():
  contract,data=source.load()
  raw=(target/'private-diagnostic-manifest-v1.json').read_bytes();manifest=json.loads(raw)
  if (target/'private-diagnostic-manifest-v1.json').stat().st_mode&0o777!=0o444:raise ValueError('MANIFEST_MODE')
  for name,h in manifest['sha256'].items():
   f=target/name
   if f.stat().st_mode&0o777!=0o444 or hashlib.sha256(f.read_bytes()).hexdigest()!=h:raise ValueError('FROZEN_HASH')
  if (target/'private-diagnostic-contract-v1.json').read_bytes()!=source.CONTRACT.read_bytes():raise ValueError('CONTRACT')
  names=('feature-lineage-v1.json','positive-profile-v1.json','b1-autopsy-v1.json','residual-capacity-v1.json')
  result=tuple(json.loads((target/name).read_bytes()) for name in names)
  independently_validate(data,result)
  source.load()
  return {'post_freeze_validator':'PASS','manifest_sha256':hashlib.sha256(raw).hexdigest()}
if __name__=='__main__':print(json.dumps(verify(sys.argv[1]),sort_keys=True))
