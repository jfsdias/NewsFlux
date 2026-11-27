"""Offline STORY-02 graph-context audit. No model/network or BLIND-label reads."""
from __future__ import annotations
import csv,hashlib,json,os,sys
from collections import Counter
from datetime import datetime,timezone
from pathlib import Path
import graph_context as g

HERE=Path(__file__).resolve().parent; A2D=HERE.parent; RESEARCH=HERE.parents[1]
PRIVATE=Path.home()/"NewsFlux-STORY00/private-p4"
FRESH_CORPUS=PRIVATE/"story02-a2d2b/20261027T142244Z/r3b-systematic-v1/fresh-home-corpus-v1.jsonl"
P2=PRIVATE/"story02-a2d2c/p2-fresh-features/attempt-20261027-v1/frozen-v1"; FEATURES=P2/"fresh-p3-feature-universe-v1.jsonl"; P2_MANIFEST=P2/"feature-p2-manifest-v1.json"
P3=PRIVATE/"story02-a2d2c/p3-pack-search/attempt-20261027-r1-v1"; DEV_PACK=P3/"dev/annotation-pack-v1.csv"; BLIND_PACK=P3/"blind/annotation-pack-v1.csv"
OLD_DEV=PRIVATE/"story02-a2d2c/p4-dev-analysis/attempt-20261027-v1/dev-pair-diagnostics-v1.jsonl"
INGEST=PRIVATE/"story02-a2d2c/p4-human-labeling/session-20261027-v1/ingested-v1/human-label-ingestion-manifest-v1.json"
HROOT=PRIVATE/"20261023-220212"; HCORPUS=HROOT/"home-200.jsonl"; HPAIRS=HROOT/"r3a-bakeoff-v1/all-crossfeed-168h-pairs.csv"
GOLD=PRIVATE/"story02-gold-v2/story-identity-gold-v2.csv"; BRIDGE=A2D/"fresh_feature_v2/FUNCTIONAL_BRIDGE_REPORT.md"
HVECS_SHA="9818b4081dc404eb8a8d842b377c99c43a5d7c33ce9888ae1cffa8dd8e207904"; BRIDGE_SHA="ce7787b40ed647ded3fbf99c58c44b860b3f361cc292083c5f5ffaa92606d710"
BLIND_SEALED_SHA="e1dcc5396c239b6e58ede6c5661fece4dc0cbc4043d1e7772b516616f9716588"
LABELS=("SAME_EVENT","RELATED_TOPIC","DIFFERENT_EVENT","UNCERTAIN")
HASHES={
 FRESH_CORPUS:"3e84fa54b8d6b055334510ec992095fd634ae33ab7eebaa9546ecaf0b511a206",
 FEATURES:"0a015ad9ea3574357230b71dbc601fc5709f161f47e638b9e520d041cdad26da", P2_MANIFEST:"0c9fb6ec2c9a5b3134d9ed0002ba8c832e52f3fcc7906aabaa4b5d083757d95e",
 DEV_PACK:"a5168490d1daeee383934a47b8982341eaaa7e78a17343020e21ca7425a0ed10", BLIND_PACK:"e5452ddb6df47d16b3da60d729d18a8186b2354a33e55de8ffbb755c5fc8b41b",
 OLD_DEV:"20373b25eaeb7d7b97c895164e74ee1c37d3b5d85d8f3a74f66060ad83fb57b8", INGEST:"590ee4b36f067676dcbb7bffdfb22ea0d174e42a884e89ce1cb638c013b59156",
 HCORPUS:"0dbd48cdb37063f3a1683f7ef8fc9a2582196a2e8d42c34485b85e12242178f0", HPAIRS:"bd50a4d4e316e2bdd0b6735c1df8c3fe52f6dc14878923325dd2794cfeb3eb14",
 GOLD:"3851a1a6c6107b417e217eacb4d709f6a8b76a678fb0bfd53b7713bc0d6368f4"}

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def verify(paths):
 for p in paths:
  if sha(p)!=HASHES[p]:raise ValueError(f"hash mismatch: {p}")
def load_jsonl(p):return [json.loads(x) for x in Path(p).read_text().splitlines() if x.strip()]
def freeze(p,data):
 p=Path(p)
 if p.exists():raise FileExistsError(p)
 p.parent.mkdir(parents=True,exist_ok=True,mode=0o700); t=p.with_name("."+p.name+".tmp")
 with t.open("xb") as f:f.write(data);f.flush();os.fsync(f.fileno())
 h=hashlib.sha256(data).hexdigest()
 if sha(t)!=h:raise ValueError("pre-freeze hash")
 os.replace(t,p);p.chmod(0o444)
 if sha(p)!=h or p.stat().st_mode&0o777!=0o444:raise ValueError("post-freeze hash/mode")
 return h
def frozen(p,data):
 if not Path(p).exists() or Path(p).stat().st_mode&0o777!=0o444 or sha(p)!=hashlib.sha256(data).hexdigest():raise ValueError("freeze-before-label gate")

def bridge_gate(data=None):
 data=BRIDGE.read_bytes() if data is None else data
 if hashlib.sha256(data).hexdigest()!=BRIDGE_SHA:raise ValueError("bridge drift")
 text=data.decode(); needed=("All 200 matched their corresponding stored historical vector values exactly.","For 18,953 historical cross-feed pairs, all cosine-score differences were `0.0`","Spearman rho was `1.0`","Transfer of the designated fixed Qwen thresholds is authorized by full functional equivalence.")
 if not all(x in text for x in needed):raise ValueError("bridge evidence")
 return {"historical_pair_score_reproduction":"EXACT","pair_score_count":18953,"max_delta":0.0,"spearman":1.0}
def ingestion_gate():
 verify([INGEST]); m=json.loads(INGEST.read_bytes())
 if m.get("blind_state")!="ANNOTATED_SEALED" or m.get("blind_sealed_artifact_sha256")!=BLIND_SEALED_SHA:raise ValueError("sealed state")

def pair_key(r):
 if r.get("pair_key"):a,b=map(int,str(r["pair_key"]).split(":"))
 else:
  cols=next(((x,y) for x,y in (("id_a","id_b"),("entry_a_id","entry_b_id"),("article_a_id","article_b_id")) if r.get(x) not in (None,"") and r.get(y) not in (None,"")),None)
  if not cols:raise ValueError("pair columns")
  a,b=int(r[cols[0]]),int(r[cols[1]])
 return f"{min(a,b)}:{max(a,b)}"
def pair_csv(p):
 with Path(p).open(newline="") as f:return [pair_key(r) for r in csv.DictReader(f)]
def exclusions():
 keys=set(pair_csv(DEV_PACK)+pair_csv(BLIND_PACK)); ids={i for k in keys for i in map(int,k.split(":"))}
 if len(keys)!=128:raise ValueError("existing pack pair count")
 return ids

def historical_vectors():
 override=os.environ.get("NEWSFLUX_HISTORICAL_VECTORS")
 if override:
  p=Path(override).expanduser().resolve()
  if sha(p)!=HVECS_SHA:raise ValueError("historical vector override")
  return p
 matches=[]
 for root in (HROOT,PRIVATE/"story02-a2d2c/feature-v2"):
  if not root.exists():continue
  for p in root.rglob("*"):
   if p.is_file() and g.SEALED_BLIND_NAME not in p.name and "p4-human-labeling" not in str(p):
    try:
     if sha(p)==HVECS_SHA:matches.append(p)
    except (OSError,PermissionError):pass
 if len(set(matches))!=1:raise ValueError("historical vectors unresolved; set NEWSFLUX_HISTORICAL_VECTORS")
 return matches[0]
def ts(x):
 try:
  value=float(x)
 except (ValueError,TypeError):
  value=None
 if value is not None:
  import math
  if not math.isfinite(value):raise ValueError("timestamp must be finite")
  return value
 d=datetime.fromisoformat(str(x).replace("Z","+00:00"))
 if d.tzinfo is None:raise ValueError("timestamp timezone")
 return d.timestamp()
def historical_features():
 sys.path.insert(0,str(RESEARCH));sys.path.insert(0,str(A2D/"fresh_feature_v2"))
 from harness import FeatureExtractor
 from feature_contract import cosine,validate_vectors
 arts=load_jsonl(HCORPUS); v=json.loads(historical_vectors().read_bytes())
 if len(arts)!=200 or v.get("ids")!=[x["id"] for x in arts]:raise ValueError("historical vector order")
 validate_vectors(v["embeddings"],200); corpus={int(x["id"]):x for x in arts}; vec={int(x["id"]):z for x,z in zip(arts,v["embeddings"])}; keys=pair_csv(HPAIRS)
 if len(keys)!=18953 or len(set(keys))!=18953:raise ValueError("historical pair count")
 out=[]
 for key in keys:
  ai,bi=map(int,key.split(":"));a,b=corpus[ai],corpus[bi];ta,tb=ts(a["published_at"]),ts(b["published_at"])
  inp={"id_a":str(ai),"id_b":str(bi),"feed_id_a":str(a["feed_id"]),"feed_id_b":str(b["feed_id"]),"title_a":a["title"],"title_b":b["title"],"feed_a":a.get("feed_title") or "","feed_b":b.get("feed_title") or "","published_at_a":str(ta),"published_at_b":str(tb),"qwen_score":"0"}; f=FeatureExtractor.extract_features(inp,corpus_lookup=corpus)
  out.append({"pair_key":key,"article_a_id":ai,"article_b_id":bi,"feed_a_id":a["feed_id"],"feed_b_id":b["feed_id"],"category_a":str(a.get("category_id","")),"category_b":str(b.get("category_id","")),"published_at_a":datetime.fromtimestamp(ta,timezone.utc).isoformat(),"published_at_b":datetime.fromtimestamp(tb,timezone.utc).isoformat(),"qwen_score":cosine(vec[ai],vec[bi]),"lexical_overlap":f["title_overlap_coefficient"],"temporal_delta_hours":f["published_delta_hours"],"entity_anchor_overlap":f["entity_anchor_overlap"],"number_overlap":f["number_overlap"],"date_overlap":f["date_overlap"]})
 return out

def gold_rows(rows=None):
 if rows is None:
  with GOLD.open(newline="") as f:rows=list(csv.DictReader(f))
 out=[]
 for r in rows:
  label=r.get("human_decision") or r.get("gold_label") or r.get("decision") or r.get("label")
  if label not in LABELS:raise ValueError("Gold label")
  out.append({"pair_key":pair_key(r),"human_decision":label})
 c=Counter(x["human_decision"] for x in out)
 if len(out)!=233 or len({x["pair_key"] for x in out})!=233 or c!=Counter({"SAME_EVENT":57,"RELATED_TOPIC":27,"DIFFERENT_EVENT":149}):raise ValueError("Gold contract")
 return out
def identity_digest(values):
 return hashlib.sha256(g.canonical_json_bytes(sorted(set(values)))).hexdigest()

def validate_gold_graph_coverage(gold_pair_keys,gold_article_ids,home200_article_ids,historical_source_pair_keys,historical_context_pair_keys):
 pairs=list(gold_pair_keys); gold=set(pairs); articles=set(gold_article_ids); home=set(home200_article_ids); source=set(historical_source_pair_keys); context=set(historical_context_pair_keys)
 inferred={int(i) for pair in gold for i in pair.split(":")}
 result={"gold_pair_count":len(pairs),"gold_unique_pair_count":len(gold),"gold_pair_set_sha256":identity_digest(gold),"gold_article_count":len(articles),"gold_article_set_sha256":identity_digest(articles),"home200_article_count":len(home),"historical_source_pair_count":len(source),"historical_context_pair_count":len(context),"gold_pair_missing_from_historical_source":len(gold-source),"gold_pair_missing_from_historical_context":len(gold-context),"gold_article_missing_from_home200":len(articles-home)}
 if len(pairs)!=233 or len(gold)!=233 or len(articles)!=153 or inferred!=articles or len(home)!=200 or len(source)!=18953 or any(result[k] for k in ("gold_pair_missing_from_historical_source","gold_pair_missing_from_historical_context","gold_article_missing_from_home200")): raise ValueError("Gold coverage gate failed")
 return {**result,"gold_graph_compatibility_gate":"PASS","gold_identity_subset_home200_gate":"PASS","gold_coverage_validated_before_diagnostics":True}

def old_dev_rows():
 rows=load_jsonl(OLD_DEV);c=Counter(x["human_decision"] for x in rows)
 if len(rows)!=80 or c!=Counter({"DIFFERENT_EVENT":79,"RELATED_TOPIC":1}):raise ValueError("old DEV contract")
 return [{"pair_key":x["pair_key"],"human_decision":x["human_decision"]} for x in rows]
def diagnostic(ctx,labels,strategy,families=()):
 lab={x["pair_key"]:x["human_decision"] for x in labels};c=Counter();same=[]
 for r in ctx:
  if r["pair_key"] in lab and g.matches_strategy(r,strategy):c[lab[r["pair_key"]]]+=1;same+=([tuple(map(int,r["pair_key"].split(":")))] if lab[r["pair_key"]]=="SAME_EVENT" else [])
 return {"strategy":strategy,"match_count":sum(c.values()),**{x:c[x] for x in LABELS},"same_event_families":sum(any(a in fam and b in fam for a,b in same) for fam in families)}
def capacity(ctx,strategy):
 rows=[r for r in ctx if g.matches_strategy(r,strategy)]
 return {"strategy":strategy,"raw_pair_count":len(rows),"unique_article_count":len({x for r in rows for x in (r["article_a_id"],r["article_b_id"])}),"unique_feed_count":len({x for r in rows for x in (r["feed_a_id"],r["feed_b_id"])}),"unique_source_pair_count":len({tuple(sorted((str(r["feed_a_id"]),str(r["feed_b_id"])))) for r in rows}),"article_disjoint_max":g.article_disjoint_max(rows)}
def signal_gate(ev,near,feas):
 es={x["strategy"] for x in ev if x.get("SAME_EVENT",x.get("same",0))>=8 and x.get("same_event_families",x.get("families",0))>=4};ns={x["strategy"] for x in near if x.get("RELATED_TOPIC",x.get("related",0))>=4}
 return any(x["status"]=="FEASIBLE" and x["event"] in es and x["near"] in ns for x in feas)
def privacy(text):
 low=text.lower()
 if any(x in low for x in ("pair_key=","title_a=","title_b=")):raise ValueError("tracked privacy")
 if g.SEALED_BLIND_NAME.lower() in low and any(x.lower() in low for x in LABELS):raise ValueError("BLIND leakage")

def old_dev_context(all_rows,excluded,labels):
 by={r["pair_key"]:r for r in all_rows};out=[]
 for x in sorted(labels,key=lambda z:z["pair_key"]):
  key=x["pair_key"]
  if key not in by:raise ValueError("old DEV pair missing")
  endpoints=set(map(int,key.split(":")));ctx=g.materialize_graph_context(all_rows,set(excluded)-endpoints);m=next((r for r in ctx if r["pair_key"]==key),None)
  if m is None:raise ValueError("old DEV context missing")
  out.append(m)
 return out

def validate_context_counts(fresh_source_count,historical_source_count,historical_context_count):
 if fresh_source_count!=33135 or historical_source_count!=18953 or not 0<=historical_context_count<=historical_source_count:raise ValueError("context count")

def derive_context():
 verify([FRESH_CORPUS,FEATURES,P2_MANIFEST,DEV_PACK,BLIND_PACK,INGEST,HCORPUS,HPAIRS]);bridge_gate();ingestion_gate();exc=exclusions();fresh_source=load_jsonl(FEATURES);historical_source=historical_features();fresh=g.materialize_graph_context(fresh_source,exc);hist=g.materialize_graph_context(historical_source,set())
 validate_context_counts(len(fresh_source),len(historical_source),len(hist))
 return exc,fresh,hist

def audit(fresh,hist,oldctx,hist_path,catalog_path):
 frozen(hist_path,b"".join(g.canonical_json_bytes(r) for r in sorted(hist,key=lambda z:z["pair_key"])));frozen(catalog_path,g.canonical_json_bytes(g.STRATEGY_CATALOG));verify([OLD_DEV,GOLD]);gold=gold_rows(); keys=[x["pair_key"] for x in gold]; ids={int(i) for key in keys for i in key.split(":")}; coverage=validate_gold_graph_coverage(keys,ids,{int(x["id"]) for x in load_jsonl(HCORPUS)},pair_csv(HPAIRS),{r["pair_key"] for r in hist});families=g.same_event_families(gold)
 if len(families)!=10:raise ValueError("Gold family count")
 old=old_dev_rows();ev=[diagnostic(hist,gold,s,families) for s in g.STRATEGY_CATALOG["event"]];near=[diagnostic(hist,gold,s,families) for s in g.STRATEGY_CATALOG["near"]];olde=[diagnostic(oldctx,old,s) for s in g.STRATEGY_CATALOG["event"]];oldn=[diagnostic(oldctx,old,s) for s in g.STRATEGY_CATALOG["near"]];caps=[capacity(fresh,s) for s in [*g.STRATEGY_CATALOG["event"],*g.STRATEGY_CATALOG["near"]]]
 feas=[]
 for e in g.STRATEGY_CATALOG["event"]:
  for n in g.STRATEGY_CATALOG["near"]:
   for t,q in g.STRATEGY_CATALOG["templates"].items():feas.append({"event":e,"near":n,"template":t,"status":g.pack_feasible(fresh,e,n,q)["status"]})
 ed={x["strategy"]:x for x in ev};nd={x["strategy"]:x for x in near};fi=[{"id":f'{x["event"]}/{x["near"]}/{x["template"]}',"same":ed[x["event"]]["SAME_EVENT"],"families":ed[x["event"]]["same_event_families"],"different":ed[x["event"]]["DIFFERENT_EVENT"],"related":nd[x["near"]]["RELATED_TOPIC"],"feasible":x["status"]=="FEASIBLE"} for x in feas];front=sorted(x["id"] for x in g.nondominated(fi));ep=sorted(x["strategy"] for x in ev if x["SAME_EVENT"]>=8 and x["same_event_families"]>=4);np=sorted(x["strategy"] for x in near if x["RELATED_TOPIC"]>=4);feasible={f'{x["event"]}/{x["near"]}/{x["template"]}' for x in feas if x["status"]=="FEASIBLE"};rec=sorted(x for x in front if x in feasible and x.split('/')[0] in ep and x.split('/')[1] in np);passed=signal_gate(ev,near,feas)
 return {**coverage,"gold_positive_family_count":10,"event_diagnostics":ev,"near_diagnostics":near,"old_dev_event":olde,"old_dev_near":oldn,"fresh_capacity":caps,"feasibility":feas,"g40_feasible_config_count":sum(x["template"]=="G40" and x["status"]=="FEASIBLE" for x in feas),"g48_feasible_config_count":sum(x["template"]=="G48" and x["status"]=="FEASIBLE" for x in feas),"fully_feasible_config_count":sum(x["status"]=="FEASIBLE" for x in feas),"non_dominated_configs":front,"recommended_for_pm_review":rec,"event_signal_passing_strategies":ep,"near_miss_passing_strategies":np,"graph_context_signal_gate":"PASS" if passed else "FAIL","research_recommendation":"GRAPH_CONTEXT_RETRIEVAL_PROMISING" if passed else "TITLE_ONLY_GRAPH_CONTEXT_INSUFFICIENT","next_recommended_track":"STORY_02_A2D2C_P4_D2A_R3_GRAPH_RETRIEVAL_CONTRACT_FREEZE_AND_SELECTION" if passed else "STORY_02_A2D2C_P4_D2A_R3_RICHER_EVENT_SIGNAL_DESIGN"}

def run(dest):
 dest=Path(dest).resolve();allowed=(PRIVATE/"story02-a2d2c/p4-graph-context-retrieval").resolve()
 if not dest.is_relative_to(allowed) or dest==allowed or dest.exists():raise ValueError("new private destination")
 with g.blind_guard():
  exc,f1,h1=derive_context();_,f2,h2=derive_context();fb=b"".join(g.canonical_json_bytes(r) for r in sorted(f1,key=lambda z:z["pair_key"]));hb=b"".join(g.canonical_json_bytes(r) for r in sorted(h1,key=lambda z:z["pair_key"]));
  if fb!=b"".join(g.canonical_json_bytes(r) for r in sorted(f2,key=lambda z:z["pair_key"])) or hb!=b"".join(g.canonical_json_bytes(r) for r in sorted(h2,key=lambda z:z["pair_key"])):raise ValueError("context replay")
  fsha=freeze(dest/"fresh-graph-context-features-v1.jsonl",fb);hsha=freeze(dest/"historical-graph-context-features-v1.jsonl",hb);csha=freeze(dest/"graph-strategy-catalog-v1.json",g.canonical_json_bytes(g.STRATEGY_CATALOG));labels=old_dev_rows();oldctx=old_dev_context(load_jsonl(FEATURES),exc,labels);a1=audit(f1,h1,oldctx,dest/"historical-graph-context-features-v1.jsonl",dest/"graph-strategy-catalog-v1.json");a2=audit(f2,h2,oldctx,dest/"historical-graph-context-features-v1.jsonl",dest/"graph-strategy-catalog-v1.json")
  if g.canonical_json_bytes(a1)!=g.canonical_json_bytes(a2):raise ValueError("audit replay")
  def csvbytes(rows):
   import io
   fields=sorted({k for r in rows for k in r});o=io.StringIO(newline="");w=csv.DictWriter(o,fieldnames=fields,lineterminator="\n");w.writeheader();[w.writerow({k:r.get(k,"") for k in fields}) for r in rows];return o.getvalue().encode()
  receipt={"version":"STORY_02_GOLD_COVERAGE_V1","gold_sha256":HASHES[GOLD],"home200_sha256":HASHES[HCORPUS],"historical_pair_universe_sha256":HASHES[HPAIRS],"historical_graph_context_sha256":hsha,**{k:v for k,v in a1.items() if k.startswith("gold_") or k in ("home200_article_count","historical_source_pair_count","historical_context_pair_count")}}; rsha=freeze(dest/"gold-coverage-receipt-v1.json",g.canonical_json_bytes(receipt));
  diag=[{"group":name,**r} for name in ("event_diagnostics","near_diagnostics","old_dev_event","old_dev_near","fresh_capacity") for r in a1[name]];dsha=freeze(dest/"graph-strategy-diagnostics-v1.csv",csvbytes(diag));psha=freeze(dest/"graph-pack-feasibility-v1.csv",csvbytes(a1["feasibility"]));public={**a1,"historical_source_pair_count":18953,"historical_graph_context_pair_count":len(h1),"historical_24h_count_semantics_gate":"PASS","fresh_unused_article_count":500-len(exc),"fresh_eligible_pair_count":len(f1),"graph_strategy_catalog_sha256":csha,"gold_context_features_frozen_before_label_join":True,"blind_state":"ANNOTATED_SEALED","blind_prelabel_identity_access":"EXCLUSION_ONLY","blind_human_label_access":"NO","blind_label_file_accesses":0,"blind_content_parsed":"NO","blind_evaluation_run":"NO","model_inference_calls":0,"external_ai_calls":0,"new_final_pair_selection":"NO","new_pack_frozen":"NO","new_human_labels":0};asha=freeze(dest/"graph-context-audit-v1.json",g.canonical_json_bytes(public));manifest={"gold_coverage_receipt_sha256":rsha,"version":"STORY_02_GRAPH_CONTEXT_RETRIEVAL_V1","p2_feature_universe_sha256":HASHES[FEATURES],"fresh_corpus_sha256":HASHES[FRESH_CORPUS],"historical_corpus_sha256":HASHES[HCORPUS],"historical_pair_universe_sha256":HASHES[HPAIRS],"gold_v2_sha256":HASHES[GOLD],"historical_vectors_sha256":HVECS_SHA,"bridge_report_sha256":BRIDGE_SHA,"fresh_graph_context_sha256":fsha,"historical_graph_context_sha256":hsha,"graph_strategy_catalog_sha256":csha,"strategy_diagnostics_sha256":dsha,"pack_feasibility_sha256":psha,"graph_context_audit_sha256":asha,"graph_context_replay_gate":"PASS","gold_context_features_frozen_before_label_join":True,"blind_state":"ANNOTATED_SEALED","blind_human_label_access":"NO","model_inference_calls":0};msha=freeze(dest/"graph-context-manifest-v1.json",g.canonical_json_bytes(manifest));return {**public,**manifest,"graph_context_manifest_sha256":msha}

def find_unique_sha(root,expected):
 matches=[p for p in Path(root).rglob("*") if p.is_file() and g.SEALED_BLIND_NAME not in p.name and sha(p)==expected]
 if len(matches)!=1:raise ValueError(f"expected one SHA match, got {len(matches)}")
 return matches[0]

BRIDGE_REPORT_SHA256=BRIDGE_SHA
verify_bridge_report_bytes=bridge_gate
freeze_bytes=freeze
require_frozen_match=frozen
validate_gold_rows=gold_rows
strategy_diagnostic=diagnostic
graph_signal_gate=signal_gate
validate_tracked_report_privacy=privacy

if __name__=="__main__":
 if len(sys.argv)!=2:raise SystemExit("usage: audit_graph_retrieval.py PRIVATE_ATTEMPT_DIR")
 print(json.dumps(run(Path(sys.argv[1])),sort_keys=True))
