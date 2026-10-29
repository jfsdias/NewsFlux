"""Label-blind deterministic exact-k selection."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'fresh_positive_neutral_review'))
from exact_k_matching import exact_k_matching, capacity


def rank(row):
    return (-row['qwen'],-row['support'],-row['lexical'],row['gap'],row['a'],row['b'])


def select(rows,k):
    sorted_rows=sorted(rows,key=rank)
    if any(x['a']>=x['b'] or x['a']<=0 for x in sorted_rows):raise ValueError('noncanonical endpoints')
    edges=[{'article_id_a':x['a'],'article_id_b':x['b'],'deterministic_rank':i} for i,x in enumerate(sorted_rows,1)]
    chosen,trace=exact_k_matching(edges,k)
    return [sorted_rows[x['deterministic_rank']-1] for x in chosen],[x['deterministic_rank'] for x in chosen],trace
