"""Preservation transforms for the reviewed main-card display layout.

Called by main_display_package.py after source, author and input validation.
These transforms preserve every pre-existing string/style and unrelated part.
"""
import hashlib,re,xml.etree.ElementTree as ET
from openpyxl.utils.cell import column_index_from_string
import spell_bodies_package as p
from spell_display_fields import clone_text
from spell_display_labels import set_element_text
if not __debug__:raise RuntimeError('Verification requires assertions; do not use -O')
sha=lambda b:hashlib.sha256(b).hexdigest()
PART='xl/worksheets/sheet2.xml'
STYLES='xl/styles.xml'

def apply_labels(version,seed,planned):
 cfg=planned['versions'][version];assert sha(seed)==cfg['seed_sha256'];parts,_,_=p.read_zip(seed);sheet=parts[PART];cells=p.indexed_cells(sheet);strings=p.spans(parts[p.SST],'si');clones=[];clone_ids={};changes={}
 for e in cfg['statics']:
  ref=e['cell'];cell=cells[ref];assert sha(cell)==e['cell_sha256'];si=strings[int(p.fragment(cell).findtext(p.q('v')))][1];assert sha(si)==e['si_sha256']
  clone=clone_text(si,e['target']);assert sha(clone)==e['clone_sha256']
  if clone not in clone_ids:clone_ids[clone]=len(clones);clones.append(clone)
  changed=set_element_text(cell,'v',str(len(strings)+clone_ids[clone]));assert p.strip_elements(changed,'v')==p.strip_elements(cell,'v')
  assert sheet.count(cell)==1;sheet=sheet.replace(cell,changed,1);changes[ref]=changed
 original_dv=p.spans(sheet,'dataValidation')
 for e in reversed(cfg['messages']):
  raw=original_dv[e['index']][1];assert sha(raw)==e['before_sha256']
  value=p.escape(e['after'],{'"':'&quot;'}).replace('\n','&#10;').replace('\r','&#13;').encode('utf8')
  changed,n=re.subn(rb'\bprompt="[^"]*"',lambda _:b'prompt="'+value+b'"',raw,count=1);assert n==1
  assert p.fragment(changed).attrib=={**p.fragment(raw).attrib,'prompt':e['after']}
  assert list(map(ET.tostring,p.fragment(changed)))==list(map(ET.tostring,p.fragment(raw)))
  assert sheet.count(raw)==1;sheet=sheet.replace(raw,changed,1)
 sst=parts[p.SST].replace(b'</sst>',b''.join(clones)+b'</sst>')
 sst,n=re.subn(rb'(<sst\b[^>]*\buniqueCount=")[0-9]+(")',lambda m:m[1]+str(len(strings)+len(clones)).encode()+m[2],sst,count=1);assert n==1
 out=p.write_zip(seed,{PART:sheet,p.SST:sst});after,_,_=p.read_zip(out)
 assert {k for k in parts if parts[k]!=after[k]}=={PART,p.SST};nc=p.indexed_cells(after[PART]);assert cells.keys()==nc.keys()
 assert {k for k in cells if cells[k]!=nc[k]}==set(changes)
 for ref in changes:assert nc[ref]==changes[ref]
 assert [s[1] for s in p.spans(after[p.SST],'si')[:len(strings)]]==[s[1] for s in strings]
 assert p.strip_elements(p.strip_elements(parts[PART],'c'),'dataValidation')==p.strip_elements(p.strip_elements(after[PART],'c'),'dataValidation')
 ndv=p.spans(after[PART],'dataValidation');assert len(ndv)==len(original_dv);changed_indexes={e['index'] for e in cfg['messages']}
 for i,(before,now) in enumerate(zip(original_dv,ndv)):
  if i not in changed_indexes:assert before[1]==now[1]
 for e in planned['deferred']:
  if e['version']==version:assert cells[e['cell']]==nc[e['cell']]
 return out,{'static_cells':len(changes),'prompt_messages':len(cfg['messages']),'new_unique_strings':len(clones),'all_formulas_styles_validations_rules_original_strings_and_other_parts_preserved':True,'deferred_cells_preserved':sum(e['version']==version for e in planned['deferred'])}

def attrs(values):return b' '.join(k.encode()+b'="'+p.escape(str(v),{'"':'&quot;'}).replace('\n','&#10;').encode('utf8')+b'"' for k,v in values.items())

def attribute(raw,name,value):
 end=raw.index(b'>')+1;head=raw[:end];pat=rb'\b'+name.encode()+rb'="[^"]*"';quoted=name.encode()+b'="'+p.escape(str(value),{'"':'&quot;'}).encode()+b'"'
 if re.search(pat,head):head,n=re.subn(pat,lambda _:quoted,head,count=1);assert n==1
 else:
  at=-2 if head.endswith(b'/>') else -1;head=head[:at]+b' '+quoted+head[at:]
 return head+raw[end:]

def container(raw,tag,child,count):
 assert raw.count(b'</'+tag.encode()+b'>')==1
 updated=raw.replace(b'</'+tag.encode()+b'>',b''.join(child)+b'</'+tag.encode()+b'>')
 return attribute(updated,'count',count)

def apply_captions(version,seed,layout):
 assert sha(seed)==layout['expected_labels'][version];plan=layout['captions'];parts,_,_=p.read_zip(seed);sheet=parts[PART];styles=parts[STYLES];cells=p.indexed_cells(sheet);sst=parts[p.SST];strings=p.spans(sst,'si')
 fonts_raw=p.spans(styles,'fonts')[0][1];fonts=p.spans(fonts_raw,'font');xfs_raw=p.spans(styles,'cellXfs')[0][1];xfs=p.spans(xfs_raw,'xf')
 newfonts=[];font_ids={};newxfs=[];xf_ids={};newstrings=[];si_ids={};changed={};hints=[];receipts=[]
 for e in (r for r in plan['entries'] if r['version']==version and 'prompt_index' not in r):
  ref=e['cell'];raw=cells[ref];c=p.fragment(raw);assert c.get('t')=='s' and c.find(p.q('f')) is None
  index=int(c.findtext(p.q('v')));si=strings[index][1];assert p.visible_text(p.fragment(si))==e['full_target']
  xf=xfs[int(c.get('s','0'))][1];fn=fonts[int(p.fragment(xf).get('fontId'))][1];font=fn
  for tag,val in [('name','Arial'),('sz',format(e['font_size'],'g'))]:
   old=p.spans(font,tag);assert len(old)==1;font=font.replace(old[0][1],attribute(old[0][1],'val',val),1)
  font=p.strip_elements(p.strip_elements(font,'scheme'),'charset')
  if not e['bold']:font=p.strip_elements(font,'b')
  color=p.spans(font,'color')
  if color and p.fragment(color[0][1]).get('theme')=='0' and p.fragment(color[0][1]).get('tint')=='-0.499984740745262':font=font.replace(color[0][1],b'<color rgb="FF595959"/>',1)
  if font not in font_ids:font_ids[font]=len(fonts)+len(newfonts);newfonts.append(font)
  nx=attribute(xf,'fontId',font_ids[font]);nx=attribute(nx,'applyFont','1');nx=attribute(nx,'applyAlignment','1')
  al=p.spans(nx,'alignment');values=p.fragment(al[0][1]).attrib if al else {};values={**values,'horizontal':'center','vertical':'center','wrapText':'1' if '\n' in e['target'] else '0','shrinkToFit':'0'}
  align=b'<alignment '+attrs(values)+b'/>'
  if al:nx=nx.replace(al[0][1],align,1)
  else:nx=nx.replace(b'</xf>',align+b'</xf>');assert b'</xf>' in nx
  if nx not in xf_ids:xf_ids[nx]=len(xfs)+len(newxfs);newxfs.append(nx)
  out=attribute(raw,'s',xf_ids[nx])
  if e['target']!=e['full_target']:
   clone=clone_text(si,e['target'])
   if clone not in si_ids:si_ids[clone]=len(strings)+len(newstrings);newstrings.append(clone)
   out=set_element_text(out,'v',str(si_ids[clone]))
   assert len(e['full_target'].encode('utf-16-le'))//2<=255
   hint={'type':'none','allowBlank':'1','showInputMessage':'1','promptTitle':'Details','prompt':e['full_target'],'sqref':ref}
   hints.append(b'<dataValidation '+attrs(hint)+b'/>')
  assert sheet.count(raw)==1;sheet=sheet.replace(raw,out,1);changed[ref]=out
  receipts.append({'cell':ref,'caption':e['target'],'full_target':e['full_target'],'font_size':e['font_size'],'font_id':font_ids[font],'style_id':xf_ids[nx],'input_hint_added':e['target']!=e['full_target']})
 dv=p.spans(sheet,'dataValidations');assert len(dv)==1;old_dv=dv[0][1];old_dv_count=len(p.spans(old_dv,'dataValidation'))
 sheet=sheet.replace(old_dv,container(old_dv,'dataValidations',hints,old_dv_count+len(hints)),1)
 cols=p.spans(sheet,'cols');assert len(cols)==1;oldcols=cols[0][1];columns=ET.fromstring(oldcols);widen={column_index_from_string(x) for x in plan['widen_columns']};segments=[]
 for node in columns:
  lo=int(node.get('min'));hi=int(node.get('max'));cuts=sorted({lo,hi+1}|{n for c in widen if lo<=c<=hi for n in (c,c+1)})
  for start,end in zip(cuts,cuts[1:]):
   a={**node.attrib,'min':str(start),'max':str(end-1)}
   if start in widen:assert end==start+1;a.update(width=str(plan['new_column_width']),customWidth='1')
   segments.append(b'<col '+attrs(a)+b'/>')
 newcols=b'<cols>'+b''.join(segments)+b'</cols>';sheet=sheet.replace(oldcols,newcols,1)
 def expanded(node):
  out={}
  for col in node:
   a={k:v for k,v in col.attrib.items() if k not in ('min','max')}
   for i in range(int(col.get('min')),int(col.get('max'))+1):out[i]=a
  return out
 oldc=expanded(columns);newc=expanded(ET.fromstring(newcols));assert oldc.keys()==newc.keys()
 assert {i for i in oldc if oldc[i]!=newc[i]}==widen
 for i in widen:assert newc[i]=={**oldc[i],'width':'4','customWidth':'1'}
 styles=styles.replace(fonts_raw,container(fonts_raw,'fonts',newfonts,len(fonts)+len(newfonts)),1)
 styles=styles.replace(xfs_raw,container(xfs_raw,'cellXfs',newxfs,len(xfs)+len(newxfs)),1)
 sst=sst.replace(b'</sst>',b''.join(newstrings)+b'</sst>')
 sst,n=re.subn(rb'(<sst\b[^>]*\buniqueCount=")[0-9]+(")',lambda m:m[1]+str(len(strings)+len(newstrings)).encode()+m[2],sst,count=1);assert n==1
 raw=p.write_zip(seed,{PART:sheet,STYLES:styles,p.SST:sst});after,_,_=p.read_zip(raw)
 assert {k for k in parts if parts[k]!=after[k]}=={PART,STYLES,p.SST}
 nc=p.indexed_cells(after[PART]);assert cells.keys()==nc.keys()
 for ref in cells:
  if ref not in changed:assert cells[ref]==nc[ref]
  else:assert nc[ref]==changed[ref]
 assert [s[1] for s in p.spans(after[p.SST],'si')[:len(strings)]]==[s[1] for s in strings]
 assert [x[1] for x in p.spans(p.spans(after[STYLES],'fonts')[0][1],'font')[:len(fonts)]]==[x[1] for x in fonts]
 assert [x[1] for x in p.spans(p.spans(after[STYLES],'cellXfs')[0][1],'xf')[:len(xfs)]]==[x[1] for x in xfs]
 ndv=p.spans(after[PART],'dataValidation');assert [x[1] for x in ndv[:old_dv_count]]==[x[1] for x in p.spans(old_dv,'dataValidation')]
 strip=lambda raw:p.strip_elements(p.strip_elements(p.strip_elements(raw,'c'),'cols'),'dataValidations')
 assert strip(parts[PART])==strip(after[PART])

 return raw,{'sha256':sha(raw),'input_sha256':sha(seed),'bytes':len(raw),'static_cells':len(changed),'short_captions':len(hints),'fonts_added':len(newfonts),'styles_added':len(newxfs),'strings_added':len(newstrings),'widened_columns':plan['widen_columns'],'all_original_formulas_styles_strings_and_other_parts_preserved':True,'cells':receipts}
