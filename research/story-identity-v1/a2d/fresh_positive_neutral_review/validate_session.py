"""Independent session readback; outputs aggregate results only."""
import csv,hashlib,http.server,json,pathlib,re,socketserver,threading,urllib.error,urllib.request
from prepare_session import firewall, CORPUS,CORPUS_HASH,PACK_HASH,review
from select_review_pack import digest

def validate(root):
    root=pathlib.Path(root);public=root/'reviewer'
    with firewall():
        pack=(root/'selected-positive-review-pack-v1.jsonl').read_bytes()
        if digest(pack)!=PACK_HASH:raise ValueError('pack hash')
        selected=[json.loads(x) for x in pack.splitlines()]
        contract=(root/'neutral-review-contract-v1.json').read_bytes();ch=digest(contract)
        raw=CORPUS.read_bytes()
        if digest(raw)!=CORPUS_HASH:raise ValueError('corpus hash')
        corpus={a['id']:a for a in map(json.loads,raw.splitlines())}
        mapping=[json.loads(x) for x in (root/'neutral-review-map-v1.jsonl').read_bytes().splitlines()]
        with (public/'neutral-review-v1.csv').open(newline='') as f:rows=list(csv.DictReader(f))
        expected=sorted(selected,key=lambda x:hashlib.sha256(('STORY02-D2F2-NEUTRAL-REVIEW|'+ch+'|'+x['pair_key']).encode()).hexdigest())
        if len(rows)!=40 or len(mapping)!=40:raise ValueError('count')
        for i,(r,m,s) in enumerate(zip(rows,mapping,expected),1):
            if r['annotation_id']!=f'R{i:03}' or m['review_annotation_id']!=r['annotation_id'] or m['pair_key']!=s['pair_key']:raise ValueError('mapping or order')
            if r['human_decision'] or r['label_options']!=review.LABELS:raise ValueError('decision')
            for side,article in [('a',s['article_id_a']),('b',s['article_id_b'])]:
                a=corpus[article]
                for field,src in [('feed','feed_title'),('title','title'),('published_at','published_at')]:
                    if r[field+'_'+side]!=a[src]:raise ValueError('metadata mismatch')
        if len({m['pair_key'] for m in mapping})!=40:raise ValueError('duplicate map')
        files={'neutral_review_csv_sha256':public/'neutral-review-v1.csv','neutral_review_map_sha256':root/'neutral-review-map-v1.jsonl','review_guide_sha256':public/'REVIEW_GUIDE.md','review_html_sha256':public/'index.html'}
        receipt=json.loads((root/'neutral-review-receipt-v1.json').read_bytes());manifest=json.loads((root/'neutral-review-manifest-v1.json').read_bytes())
        if receipt['contract_sha256']!=ch or receipt['selected_pack_sha256']!=PACK_HASH or manifest['receipt_sha256']!=digest((root/'neutral-review-receipt-v1.json').read_bytes()):raise ValueError('manifest')
        for name,path in files.items():
            if digest(path.read_bytes())!=receipt[name] or path.stat().st_mode&0o777!=0o444:raise ValueError('hash/mode')
        html=(public/'index.html').read_text()
        match=re.search(r'const rows\s*=\s*(.*?)\s*const storageKey\s*=',html,re.S)
        if not match or json.loads(match.group(1))!=rows:raise ValueError('html data')
        for p in public.iterdir():
            if p.name not in {'index.html','REVIEW_GUIDE.md','neutral-review-v1.csv'}:raise ValueError('unexpected public file')
            review.privacy(p.read_bytes())
        if re.search(r'''(?:src|href)\s*=\s*["'](?:https?:)?//|\bfetch\s*\(''',html,re.I):raise ValueError('external resource')
    return {'session_validator':'PASS','count':40,'blank_decisions':40,'replay_order':'PASS','hashes':'PASS'}
if __name__=='__main__':
    import sys
    print(json.dumps(validate(sys.argv[1]),sort_keys=True))
