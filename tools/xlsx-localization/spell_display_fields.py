"""Reviewed F/G/L application, preserving exact shared-string clone reuse."""
from pathlib import Path
import hashlib,json,re,sys
import xml.etree.ElementTree as ET
import spell_bodies_package as p
if not __debug__:raise RuntimeError("Verification requires assertions; do not use -O")
sys.dont_write_bytecode=True
REPO=p.REPO
sha=lambda b:hashlib.sha256(b).hexdigest()

prep=p.planner.p
REVIEW=REPO/'tools/xlsx-localization/reviews/spell-fields-fgl-001.jsonl'
REVIEW_SHA='c8017d2b0e575d7f5aac745aebfe0d1d0bd059c501b664ef7f0138da69173edc'
CFG={}
def configure(seeds):
    global CFG
    CFG={v:{'source':REPO/'public'/prep.TEMPLATES[v],'source_sha':source,
        'seed':Path(seeds[v]).resolve(),'seed_sha':seed,'part':part,'last':last}
        for v,source,seed,part,last in [
        ('2014','94444fda4206d579125418b0007b89c414b86c27d6b98655f81f3f1ce65e8fe6','a3f151c7b99ea9f339be5571f043025ed477978c74da77ef83eb8e37aec86fbf','xl/worksheets/sheet13.xml',524),
        ('2024','264fc65569e3e80932544af548830ca70f10ee308493c8b0234608fcd01c9b04','555e25c5eb042afdc47c903650cb13ae6c8df43c02ceb50a1bfa28441402f4dd','xl/worksheets/sheet14.xml',811)]}

def clone_text(raw,target):
 p.validate_text(target)
 si=p.fragment(raw);assert len(si)==1 and si[0].tag==p.q('t')
 matches=p.spans(raw,'t');assert len(matches)==1
 _,old,a,b=matches[0];head=old[:old.index(b'>')+1]
 if (target[:1].isspace() or target[-1:].isspace()) and b'xml:space=' not in head:head=head[:-1]+b' xml:space="preserve">'
 clone=raw[:a]+head+p.escape(target).replace('\r','&#13;').encode('utf8')+b'</t>'+raw[b:]
 assert p.visible_text(p.fragment(clone))==target and p.strip_elements(raw,'t')==p.strip_elements(clone,'t')
 return clone

def build_plan():
 review_raw=REVIEW.read_bytes();assert sha(review_raw)==REVIEW_SHA
 reviews=[json.loads(line) for line in review_raw.decode('utf8').splitlines()];assert len(reviews)==3993
 glossary_path=REPO/'tools/xlsx-localization/glossary.json';glossary_raw=glossary_path.read_bytes()
 all_entries=[];versions={}
 for version,cfg in CFG.items():
  source=cfg['source'].read_bytes();seed=cfg['seed'].read_bytes();assert sha(source)==cfg['source_sha'] and sha(seed)==cfg['seed_sha']
  _,records,_=prep.inspect_xlsx(cfg['source'],version,json.loads(glossary_raw));actual={r['id']:r for r in records}
  op,_,_=p.read_zip(source);sp,_,_=p.read_zip(seed);part=cfg['part'];cells=p.indexed_cells(op[part]);seed_cells=p.indexed_cells(sp[part]);strings=p.spans(op[p.SST],'si')
  selected=[r for r in reviews if r['version']==version];selected.sort(key=lambda r:(int(r['locations'][0][1:]),r['locations'][0][0]))
  assert [r['locations'][0] for r in selected]==[col+str(row) for row in range(3,cfg['last']+1) for col in 'FGL']
  clones=[];clone_ids={};entries=[]
  for review in selected:
   ref=review['locations'][0];record=actual[review['id']]
   assert all(review[k]==record[k] for k in ('source','kind','sheet','context'))
   assert record['occurrences']==[{'part':part,'location':ref}] and review['locations']==[ref]
   assert review['source_sha256']==p.digest(review['source']) and review['workbook_sha256']==cfg['source_sha']
   assert review['dependency_review']=='pending' and review['application_approved'] is False and review['reviewed_by'] and review['note']
   cell=cells[ref];assert cell==seed_cells[ref];node=p.fragment(cell)
   assert node.get('t')=='s' and node.find(p.q('f')) is None
   index=int(node.findtext(p.q('v')));si=strings[index][1]
   assert p.visible_text(p.fragment(si))==review['source']
   clone=clone_text(si,review['target'])
   if clone not in clone_ids:clone_ids[clone]=len(clones);clones.append(clone)
   entries.append({'id':review['id'],'version':version,'sheet':'法术大全','part':part,'cell':ref,'source':review['source'],'target':review['target'],
    'source_sha256':review['source_sha256'],'target_sha256':p.digest(review['target']),'source_cell_sha256':sha(cell),'source_si_sha256':sha(si),'source_shared_index':index,
    'clone_offset':clone_ids[clone],'clone_sha256':sha(clone),'review_record_sha256':p.digest(review)})
  all_entries.extend(entries)
  versions[version]={'source_sha256':sha(source),'seed_sha256':sha(seed),'part':part,'target_cells':len(entries),'new_unique_clones':len(clones),'clone_sha256':[sha(c) for c in clones]}
  assert cfg['source'].read_bytes()==source and cfg['seed'].read_bytes()==seed
 assert REVIEW.read_bytes()==review_raw and glossary_path.read_bytes()==glossary_raw
 return {'schema':'obr-xlsx-partial-text-candidate/v1','entries':all_entries,'versions':versions,'review_sha256':REVIEW_SHA,'glossary_sha256':sha(glossary_raw),
  'scope':'Builtin F/G/L static text only, exact final clone bytes may be shared. Original A/N/other fields, formulas, custom rows and all old SST entries stay unchanged.','release_ready':False}

def apply(version,seed,plan):
 cfg=CFG[version];v=plan['versions'][version];assert sha(seed)==v['seed_sha256']
 entries=[e for e in plan['entries'] if e['version']==version];parts,infos,comment=p.read_zip(seed);part=cfg['part'];cells=p.indexed_cells(parts[part]);strings=p.spans(parts[p.SST],'si')
 clones={};changes={}
 for e in entries:
  cell=cells[e['cell']];assert sha(cell)==e['source_cell_sha256']
  raw=strings[e['source_shared_index']][1];assert sha(raw)==e['source_si_sha256']
  clone=clone_text(raw,e['target']);assert sha(clone)==e['clone_sha256']
  if e['clone_offset'] in clones:assert clones[e['clone_offset']]==clone
  else:clones[e['clone_offset']]=clone
  matches=p.spans(cell,'v');assert len(matches)==1
  _,old,a,b=matches[0];changes[e['cell']]=cell[:a]+b'<v>'+str(len(strings)+e['clone_offset']).encode()+b'</v>'+cell[b:]
 assert sorted(clones)==list(range(v['new_unique_clones'])) and [sha(clones[i]) for i in range(len(clones))]==v['clone_sha256']
 sheet=parts[part]
 for attrs,_,a,b in reversed(p.spans(sheet,'c')):
  if attrs['r'] in changes:sheet=sheet[:a]+changes[attrs['r']]+sheet[b:]
 sst=parts[p.SST].replace(b'</sst>',b''.join(clones[i] for i in range(len(clones)))+b'</sst>')
 sst=re.sub(rb'(<sst\b[^>]*\buniqueCount=")[0-9]+(")',lambda m:m[1]+str(len(strings)+len(clones)).encode()+m[2],sst,count=1)
 output=p.write_zip(seed,{part:sheet,p.SST:sst});after,new_infos,new_comment=p.read_zip(output)
 assert list(parts)==list(after) and comment==new_comment and {k for k in parts if parts[k]!=after[k]}=={part,p.SST}
 properties=('date_time','compress_type','comment','extra','create_system','create_version','extract_version','flag_bits','volume','internal_attr','external_attr')
 assert all(getattr(a,k)==getattr(b,k) for a,b in zip(infos,new_infos) for k in properties)
 a_cells=p.indexed_cells(after[part]);assert cells.keys()==a_cells.keys()
 assert {ref for ref in cells if cells[ref]!=a_cells[ref]}==set(changes)
 a_strings=p.spans(after[p.SST],'si');assert len(a_strings)==len(strings)+len(clones)
 assert [s[1] for s in a_strings[:len(strings)]]==[s[1] for s in strings]
 assert p.strip_elements(parts[part],'c')==p.strip_elements(after[part],'c')
 for e in entries:
  cell=a_cells[e['cell']];assert p.strip_elements(cell,'v')==p.strip_elements(cells[e['cell']],'v')
  index=int(p.fragment(cell).findtext(p.q('v')));assert index==len(strings)+e['clone_offset']
  assert p.visible_text(p.fragment(a_strings[index][1]))==e['target']
 return output,{'target_cells':len(entries),'new_sst_clones':len(clones),'old_sst_nodes_preserved':len(strings),'same_sheet_non_target_cells':len(cells)-len(entries),
  'all_other_parts_byte_exact':True,'zip_metadata_preserved':True,'original_keys_body_flags_custom_formulas_preserved':True}
