"""Freeze replay-identical aggregate audit results without witness identities."""
import csv,hashlib,io,json,os
from pathlib import Path
import sys
import audit_capacity as a
ROOT=Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2c/p4-dev-expansion-capacity'
def digest(b):return hashlib.sha256(b).hexdigest()
def export(first,second,dest):
 if first!=second:raise ValueError('replay mismatch')
 data=json.loads(first);rows=data['frontier'];out=io.StringIO(newline='');w=csv.DictWriter(out,fieldnames=list(rows[0]),lineterminator='\n');w.writeheader();w.writerows(rows)
 artifacts={'capacity-frontier-v1.csv':out.getvalue().encode(),'capacity-audit-v1.json':first}
 artifacts['capacity-manifest-v1.json']=(json.dumps({'catalog_sha256':a.CATALOG_HASH,'input_universe_sha256':'0a015ad9ea3574357230b71dbc601fc5709f161f47e638b9e520d041cdad26da','artifacts':{k:digest(v) for k,v in artifacts.items()},'blind_state':'ANNOTATED_SEALED','selected_pack':False},sort_keys=True,separators=(',',':'))+'\n').encode()
 target=Path(dest).resolve();root=ROOT.resolve()
 if target==root or not target.is_relative_to(root):raise ValueError('private destination')
 target.mkdir(mode=0o700,parents=False,exist_ok=False);hashes={}
 for name,value in artifacts.items():
  tmp=target/(name+'.tmp');out=target/name
  with tmp.open('xb') as f:f.write(value);f.flush();os.fsync(f.fileno())
  os.replace(tmp,out);h=digest(value)
  if digest(out.read_bytes())!=h:raise ValueError('readback')
  out.chmod(0o444)
  if out.stat().st_mode&0o777!=0o444 or digest(out.read_bytes())!=h:raise ValueError('mode or rehash')
  hashes[name]=h
 return hashes
if __name__=='__main__':
 if len(sys.argv)!=4:raise SystemExit('usage: export_audit.py AUDIT1 AUDIT2 PRIVATE_DEST')
 with a.blind_guard():print(json.dumps(export(Path(sys.argv[1]).read_bytes(),Path(sys.argv[2]).read_bytes(),sys.argv[3]),sort_keys=True))
