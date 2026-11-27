"""Fixed label-blind capacity catalog with sealed-label access guard."""
import builtins,contextlib,hashlib,io,json,math
from pathlib import Path
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
CATALOG_HASH='5eea58b56ca860657a2ec32b3f9e5dec69c6fcfdaf090bf413bcf4d936cdda1f'
CATALOG_BYTES=(HERE/'catalog.txt').read_bytes()
if hashlib.sha256(CATALOG_BYTES).hexdigest()!=CATALOG_HASH:raise ValueError('catalog drift')
CATALOG=json.loads(CATALOG_BYTES)

@contextlib.contextmanager
def blind_guard():
 forbidden='blind-human-labels-sealed-v1.jsonl';builtin=builtins.open;io_open=io.open;po=Path.open;pb=Path.read_bytes;pt=Path.read_text
 def check(p):
  if forbidden in str(p):raise PermissionError('sealed labels forbidden')
 def b(p,*x,**kw):check(p);return builtin(p,*x,**kw)
 def i(p,*x,**kw):check(p);return io_open(p,*x,**kw)
 def o(p,*x,**kw):check(p);return po(p,*x,**kw)
 def rb(p):check(p);return pb(p)
 def rt(p,*x,**kw):check(p);return pt(p,*x,**kw)
 with patch.object(builtins,'open',b),patch.object(io,'open',i),patch.object(Path,'open',o),patch.object(Path,'read_bytes',rb),patch.object(Path,'read_text',rt):yield

def quantile(values,q):
 v=sorted(values)
 if not v:raise ValueError('empty quantile')
 pos=(len(v)-1)*q;lo=int(pos);return v[lo]+(v[math.ceil(pos)]-v[lo])*(pos-lo)
def corroboration(r):return sum(r[k]>0 for k in ('lexical_overlap','entity_anchor_overlap','number_overlap','date_overlap'))
def strong(r,variant,q):
 x=CATALOG['strong'][variant];lex=r['lexical_overlap']>0 if x['lex']=='positive' else r['lexical_overlap']>=q[x['lex']]
 return r['qwen_score']>=q[x['q']] and r['temporal_delta_hours']<=x['hours'] and lex and corroboration(r)>=x['corroboration']
def text_match(r,variant,q):
 x=CATALOG['text'][variant];return r['qwen_score']>=q[x['q']] and r['temporal_delta_hours']<=x['hours'] and r['lexical_overlap']>=q[x['lex']] and (not x['entity'] or r['entity_anchor_overlap']>0)
def lane(r,s,t,q):
 if strong(r,s,q):return 'strong'
 if text_match(r,t,q):return 'text'
 if r['qwen_score']>=q['q90'] and (r['entity_anchor_overlap']>0 or r['lexical_overlap']>0):return 'near_miss'
 return 'control'
def eligible(r,excluded):return r['article_a_id'] not in excluded and r['article_b_id'] not in excluded and r['feed_a_id']!=r['feed_b_id'] and 0<=r['temporal_delta_hours']<=24

def matching_upper_bound(rows):
 if not rows:return 0
 import numpy as np
 from scipy.optimize import milp,Bounds,LinearConstraint
 from scipy.sparse import coo_matrix
 articles=sorted({r[k] for r in rows for k in ('article_a_id','article_b_id')});idx={x:i for i,x in enumerate(articles)};rr=[];cc=[]
 for j,r in enumerate(rows):
  for k in ('article_a_id','article_b_id'):rr.append(idx[r[k]]);cc.append(j)
 matrix=coo_matrix((np.ones(len(rr)),(np.array(rr,dtype='int32'),np.array(cc,dtype='int32'))),shape=(len(articles),len(rows))).tocsc()
 result=milp(-np.ones(len(rows)),integrality=np.ones(len(rows)),bounds=Bounds(0,1),constraints=LinearConstraint(matrix,0,1),options={'time_limit':30})
 return round(-result.fun) if result.status==0 else None

def max_total_witness(rows,seconds=30):
 """Prove total optimal only at cardinality bound; keep witness in memory."""
 import numpy as np
 from scipy.optimize import milp,Bounds,LinearConstraint
 from scipy.sparse import coo_matrix
 from collections import defaultdict,Counter
 if not rows:return {'status':'OPTIMAL','total':0,'rows':[]}
 groups=defaultdict(dict);vertices=set()
 for j,r in enumerate(rows):
  for side in ('a','b'):
   ident=r[f'article_{side}_id'];vertices.add(ident);groups[('article',str(ident))][j]=1
   for kind,field in (('feed','feed'),('category','category')):
    key=(kind,str(r[f'feed_{side}_id'] if field=='feed' else r[f'category_{side}']));groups[key][j]=groups[key].get(j,0)+1
  source=('source',tuple(sorted((str(r['feed_a_id']),str(r['feed_b_id'])))));groups[source][j]=1
 upper=len(vertices)//2;rr=[];cc=[];vv=[];lo=[];hi=[]
 def add(coeff,lower,upper_value):
  i=len(lo);lo.append(lower);hi.append(upper_value)
  for j,x in coeff.items():rr.append(i);cc.append(j);vv.append(x)
 add({j:1 for j in range(len(rows))},upper,upper)
 for (kind,_),coeff in groups.items():
  cap=1 if kind=='article' else math.floor(.4*upper) if kind=='feed' else math.floor(.1*upper) if kind=='source' else upper
  add(coeff,0,cap)
 mat=coo_matrix((np.asarray(vv,dtype=float),(np.asarray(rr,dtype='int32'),np.asarray(cc,dtype='int32'))),shape=(len(lo),len(rows))).tocsc()
 result=milp(np.zeros(len(rows)),integrality=np.ones(len(rows)),bounds=Bounds(0,1),constraints=LinearConstraint(mat,np.array(lo),np.array(hi)),options={'time_limit':seconds,'presolve':True})
 if result.x is None:return {'status':'UNKNOWN_BOUNDED_SEARCH','upper_bound':upper,'solver_status':int(result.status)}
 chosen=[rows[j] for j,x in enumerate(result.x) if x>.5];ids=[r[f'article_{s}_id'] for r in chosen for s in ('a','b')]
 feeds=Counter(str(r[f'feed_{s}_id']) for r in chosen for s in ('a','b'));cats=Counter(str(r[f'category_{s}']) for r in chosen for s in ('a','b'));sources=Counter(tuple(sorted((str(r['feed_a_id']),str(r['feed_b_id'])))) for r in chosen)
 if len(chosen)!=upper or len(ids)!=len(set(ids)) or max(feeds.values())>math.floor(.4*upper) or max(cats.values())>upper or max(sources.values())>math.floor(.1*upper):raise ValueError('invalid witness')
 return {'status':'OPTIMAL','total':upper,'rows':chosen}
