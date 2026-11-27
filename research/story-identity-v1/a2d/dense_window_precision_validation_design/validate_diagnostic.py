"""Independent aggregate/capacity oracle, without importing the diagnostic result function."""
from collections import Counter
import statistics
import networkx as nx

def independently_validate(data,result):
 lineage,profile,autopsy,residual=result
 labels=data['d2f4_labels']+data['d2f9_labels'];tally=Counter(x['human_decision'] for x in labels)
 if tally!={'SAME_EVENT':7,'RELATED_TOPIC':1,'DIFFERENT_EVENT':43} or len(labels)!=51:raise ValueError('INDEPENDENT_LABEL_COUNTS')
 reviewed={int(x) for r in labels for x in r['pair_key'].split(':')}
 if len(reviewed)!=102:raise ValueError('INDEPENDENT_OVERLAP')
 features={r['pair_key']:r for r in data['p2_features']};graph={r['pair_key']:r for r in data['graph_context']}
 names=('qwen_score','lexical_overlap','temporal_delta_hours','entity_anchor_overlap','number_overlap','date_overlap','shared_support_feed_count')
 for group,is_positive in [('POSITIVE',True),('NONPOSITIVE',False)]:
  subset=[x for x in labels if (x['human_decision']=='SAME_EVENT')==is_positive]
  if profile['group_summaries'][group]['pair_count']!=len(subset):raise ValueError('INDEPENDENT_GROUP')
  for name in names:
   vals=sorted((graph.get(x['pair_key'],{}).get(name,0) if name=='shared_support_feed_count' else features[x['pair_key']][name]) for x in subset)
   expected={'n':len(vals),'min':min(vals),'median':statistics.median(vals),'max':max(vals)}
   if profile['group_summaries'][group]['features'][name]!=expected:raise ValueError('INDEPENDENT_SUMMARY')
 private_pairs=profile['pairs']
 if len(private_pairs)!=51 or {(x['pair_key'],x['human_decision']) for x in private_pairs}!={(x['pair_key'],x['human_decision']) for x in labels}:raise ValueError('INDEPENDENT_PRIVATE_MEMBERSHIP')
 selected={x['pair_key'] for x in data['d2f7_pack']};out={x['pair_key'] for x in autopsy['pairs']}
 if selected!=out or len(out)!=11 or autopsy['taxonomy_counts']!={'UNEXPLAINED':11} or autopsy['b1_primary_hypothesis_status']!='PARTIALLY_SUPPORTED':raise ValueError('INDEPENDENT_B1')
 if {x['pair_key'] for x in data['d2f9_labels']}!=selected:raise ValueError('INDEPENDENT_REVIEW_MEMBERSHIP')
 selected_by_key={x['pair_key']:x for x in data['d2f7_pack']}
 for row in data['d2f9_labels']:
  original=selected_by_key[row['pair_key']]
  if any(row[k]!=original[k] for k in ('article_id_a','article_id_b','selection_position','b1_rank')):raise ValueError('INDEPENDENT_B1_IDENTITY')
 for row in autopsy['pairs']:
  f=features[row['pair_key']];g=graph.get(row['pair_key'],{})
  if row['anchor_present'] or row['supporting_feed_count']<2:raise ValueError('INDEPENDENT_HYPOTHESIS')
  if row['qwen_score']!=f['qwen_score'] or row['lexical_overlap']!=f['lexical_overlap'] or row['temporal_delta_hours']!=f['temporal_delta_hours'] or row['supporting_feed_count']!=g.get('shared_support_feed_count',0) or row['entity_overlap']!=f['entity_anchor_overlap'] or row['number_overlap']!=f['number_overlap'] or row['date_overlap']!=f['date_overlap']:raise ValueError('INDEPENDENT_B1_FEATURES')
 for strategy in ('B0','B1','B2','B3','B4','B5'):
  edges={(r['a'],r['b']) for r in data['d2f6_candidates'] if strategy in r['strategy_membership'] and r['a'] not in reviewed and r['b'] not in reviewed}
  g=nx.Graph();g.add_edges_from(edges)
  expected={'pair_count':len(edges),'unique_articles':len(g),'max_article_disjoint':len(nx.max_weight_matching(g,maxcardinality=True))}
  if residual[strategy]!=expected:raise ValueError('INDEPENDENT_CAPACITY')
 if lineage['lane_strategy_rank_components']['classification']!='NOT_COMPARABLE':raise ValueError('INDEPENDENT_LINEAGE')
 return True
