"""Phase B: materialize a neutral reviewer session after identity freeze."""
import builtins, contextlib, csv, hashlib, importlib.util, io, json, os, pathlib, re, socket, sys
from unittest.mock import patch
from select_review_pack import canon, digest, freeze, source, FILES
HERE=pathlib.Path(__file__).resolve().parent
BASE=HERE.parent/'neutral_human_review'
spec=importlib.util.spec_from_file_location('existing_review',BASE/'prepare_review_session.py')
review=importlib.util.module_from_spec(spec);spec.loader.exec_module(review)
CORPUS=pathlib.Path.home()/'NewsFlux-STORY00/private-p4/story02-a2d2b/20261027T142244Z/r3b-systematic-v1/fresh-home-corpus-v1.jsonl'
CORPUS_HASH='3e84fa54b8d6b055334510ec992095fd634ae33ab7eebaa9546ecaf0b511a206'
PACK_HASH='a2aea145956d42dca58907cc6f1f84bde16b6a3e21bdde3eb23a48777f160a90'
FORBIDDEN=('story-identity-gold-v2.csv','dev-human-labels','blind-human-labels','review-session-v1-human-completed','d2e3','normalized-content','raw-payload')
@contextlib.contextmanager
def firewall():
    def wrap(fn):
        def guarded(path,*args,**kwargs):
            if any(x in str(path).lower() for x in FORBIDDEN):raise PermissionError('forbidden data source')
            return fn(path,*args,**kwargs)
        return guarded
    def deny(*args,**kwargs):raise PermissionError('network prohibited')
    with patch.object(builtins,'open',wrap(builtins.open)),patch.object(io,'open',wrap(io.open)),patch.object(pathlib.Path,'open',wrap(pathlib.Path.open)),patch.object(pathlib.Path,'read_bytes',wrap(pathlib.Path.read_bytes)),patch.object(pathlib.Path,'read_text',wrap(pathlib.Path.read_text)),patch.object(socket.socket,'connect',deny):yield

def run(target):
    target=pathlib.Path(target);pack=target/'selected-positive-review-pack-v1.jsonl'
    with firewall():
        if pack.stat().st_mode&0o777!=0o444 or digest(pack.read_bytes())!=PACK_HASH:raise ValueError('phase A freeze required')
        if not (target/'exact-k-private-trace-v1.json').is_file():raise ValueError('phase A validation required')
        selected=[json.loads(x) for x in pack.read_bytes().splitlines()]
        contract={'version':'STORY_02_D2F2_NEUTRAL_REVIEW_V1','selected_pack_sha256':PACK_HASH,'source_pool_sha256':FILES[next(iter(FILES))],'review_budget':40,'ordering':'SHA256_STORY02-D2F2-NEUTRAL-REVIEW','evidence':'TITLE_FEED_PUBLISHED_AT_ONLY','discovery_rule':'SAME_EVENT>=1_AND_POSITIVE_COMPONENTS>=2','calibration_rule':'SAME_EVENT>=12_AND_POSITIVE_COMPONENTS>=3_AND_LARGEST_POSITIVE_COMPONENT_SHARE<=0.50','human_decisions':0}
        ch=digest(canon(contract));freeze(target/'neutral-review-contract-v1.json',canon(contract))
        raw=CORPUS.read_bytes()
        if digest(raw)!=CORPUS_HASH:raise ValueError('corpus hash')
        articles={}
        for line in raw.splitlines():
            item=json.loads(line)
            if any(k in item for k in ('content','body','html','normalized_content')):raise ValueError('body prohibited')
            articles[item['id']]=item
        order=sorted(selected,key=lambda x:digest(('STORY02-D2F2-NEUTRAL-REVIEW|'+ch+'|'+x['pair_key']).encode()))
        if [x['pair_key'] for x in order]==[x['pair_key'] for x in selected]:raise ValueError('review order matches rank order')
        rows=[];mapping=[]
        for i,r in enumerate(order,1):
            ident=f'R{i:03}';a=articles[r['article_id_a']];b=articles[r['article_id_b']]
            rows.append({'annotation_id':ident,'feed_a':a['feed_title'],'feed_b':b['feed_title'],'title_a':a['title'],'title_b':b['title'],'published_at_a':a['published_at'],'published_at_b':b['published_at'],'label_options':review.LABELS,'human_decision':''})
            mapping.append({'review_annotation_id':ident,**r})
        csvdata=review.csv_bytes(rows);csvhash=digest(csvdata)
        template=review.TEMPLATE.read_text().replace('story02-d2b','story02-d2f2')
        data=json.dumps(rows,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c').replace('>','\\u003e').replace('&','\\u0026')
        html=template.replace('__DATA__',data).replace('__STORAGE__','newsflux-story02-d2f2-'+digest((ch+'|'+csvhash).encode())[:24]).encode()
        for item in (csvdata,html,review.GUIDE):
            review.privacy(item)
            if re.search(rb'(?i)pair_key|article_id|component_id|deterministic_rank|qwen_score|lexical_overlap|positive-likelihood|positive evidence|candidate pool|discovery gate|calibration gate|/Users/',item):raise ValueError('reviewer metadata leak')
        public=target/'reviewer';public.mkdir(mode=0o700)
        items={'neutral_review_csv_sha256':(public/'neutral-review-v1.csv',csvdata),'neutral_review_map_sha256':(target/'neutral-review-map-v1.jsonl',b''.join(canon(x) for x in mapping)),'review_guide_sha256':(public/'REVIEW_GUIDE.md',review.GUIDE),'review_html_sha256':(public/'index.html',html)}
        hashes={}
        for key,(path,content) in items.items():freeze(path,content);hashes[key]=digest(content)
        receipt={'version':'STORY_02_D2F2_RECEIPT_V1','selected_pack_sha256':PACK_HASH,'contract_sha256':ch,**hashes,'human_decisions':0,'session':'PREPARED_UNOPENED'}
        freeze(target/'neutral-review-receipt-v1.json',canon(receipt));rh=digest(canon(receipt))
        manifest={'version':'STORY_02_D2F2_MANIFEST_V1','receipt_sha256':rh,**receipt}
        freeze(target/'neutral-review-manifest-v1.json',canon(manifest));mh=digest(canon(manifest))
        return {'contract_sha256':ch,**hashes,'receipt_sha256':rh,'manifest_sha256':mh}
if __name__=='__main__':print(json.dumps(run(sys.argv[1]),sort_keys=True))
