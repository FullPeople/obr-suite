"""Canonical C8 labels and the physically correct 2014 bibliography column."""
from pathlib import Path
import hashlib,json,re,sys
import xml.etree.ElementTree as ET
import spell_bodies_package as p
if not __debug__:raise RuntimeError("Verification requires assertions; do not use -O")
sys.dont_write_bytecode=True
REPO=p.REPO
sha=lambda b:hashlib.sha256(b).hexdigest()

def configuration(seeds):
    return {v:{'source':p.planner.p.TEMPLATES[v],'source_sha':source,
        'seed':Path(seeds[v]).resolve(),'seed_sha':seed,'book':book,'map':mapping,
        'data':data,'last':last,'range':span,'book_column':column,'body_applied':True}
        for v,source,seed,book,mapping,data,last,span,column in [
        ('2014','94444fda4206d579125418b0007b89c414b86c27d6b98655f81f3f1ce65e8fe6','84333210fcf8788159e57f44b4c1b2ebc01718f764d39ab1aab3020fe351d663','sheet12.xml','sheet19.xml','sheet13.xml',574,'A:W','X'),
        ('2024','264fc65569e3e80932544af548830ca70f10ee308493c8b0234608fcd01c9b04','4f3acdcff3365fb119b653e205944d9f9bdf3f6016e441399639222f9e934e58','sheet13.xml','sheet20.xml','sheet14.xml',864,'$A:$Z','Z')]}

def cell_text(cells,ref,strings):
    node=p.fragment(cells[ref])
    if node.get('t')=='s':return p.visible_text(strings[int(node.findtext(p.q('v')))])
    if node.get('t')=='inlineStr':return ''.join(t.text or '' for t in node.findall('.//'+p.q('t')))
    return node.findtext(p.q('v'))

def replace_formula(raw,before,after):
    node=p.fragment(raw)
    assert node.findtext(p.q('f'))==before and node.find(p.q('v')) is None
    matches=p.spans(raw,'f');assert len(matches)==1
    _,f,start,end=matches[0];opening=f.index(b'>')+1;closing=f.rindex(b'</f>')
    changed=raw[:start]+f[:opening]+p.escape(after).encode('utf8')+f[closing:]+raw[end:]
    assert p.strip_elements(raw,'f')==p.strip_elements(changed,'f')
    updated=p.fragment(changed)
    assert updated.find(p.q('f')).attrib==node.find(p.q('f')).attrib
    assert updated.findtext(p.q('f'))==after and updated.find(p.q('v')) is None
    return changed

def build(version,cfg,destination):
    original_path=REPO/'public'/cfg['source'];original=original_path.read_bytes()
    seed_path=cfg['seed'];seed=seed_path.read_bytes()
    assert sha(original)==cfg['source_sha'] and sha(seed)==cfg['seed_sha']
    parts,infos,comment=p.read_zip(seed);op,_,_=p.read_zip(original)
    part='xl/worksheets/'+cfg['book'];map_part='xl/worksheets/'+cfg['map']
    cells=p.indexed_cells(parts[part]);mapping=p.indexed_cells(parts[map_part])
    # The selector's MATCH offset is the actual source row, including 2024 gaps.
    helper=p.fragment(mapping['G441']).findtext(p.q('f'))
    assert helper==("IFERROR(IF(AND(ISTEXT('法术书'!C3),LEN('法术书'!C3)>0),MATCH(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE('法术书'!C3,\"~\",\"~~\"),\"*\",\"~*\"),\"?\",\"~?\"),'_OBRSpellMap'!$B$3:$B$"+str(cfg['last'])+",0)+2,0),0)")
    row_bindings={}
    for ref,raw in mapping.items():
        if re.fullmatch(r'D\d+',ref):
            node=p.fragment(raw);value=node.findtext(p.q('v'))
            if value is not None:
                assert int(value)==int(ref[1:])
                row_bindings[ref]=int(value)
    assert row_bindings['D3']==3
    old_c8="IFERROR(IF('_OBRSpellMap'!$G$441=0,VLOOKUP(C3,法术大全!"+cfg['range']+",14,FALSE),INDEX(法术大全!"+cfg['range']+",'_OBRSpellMap'!$G$441,14)),\"\")"
    new_c8="IFERROR(IF('_OBRSpellMap'!$G$441=0,VLOOKUP(C3,法术大全!"+cfg['range']+",14,FALSE),INDEX('_OBRSpellMap'!$B$3:$B$"+str(cfg['last'])+",'_OBRSpellMap'!$G$441-2)),\"\")"
    edits={'C8':(old_c8,new_c8)}
    source_cells=p.indexed_cells(op['xl/worksheets/'+cfg['data']]);sst=ET.fromstring(op[p.SST])
    assert cell_text(source_cells,cfg['book_column']+'2',sst)=='出处'
    if version=='2014':
        assert cell_text(source_cells,'X1',sst)=='26'
        assert cell_text(source_cells,'N337',sst)=='术Summon Elemental'
        original_o8=p.fragment(p.indexed_cells(op[part])['O8']).findtext(p.q('f'))
        assert original_o8=='IF(C3="","",VLOOKUP(C3,法术大全!A:X,26,FALSE))'
        old='IF(C3="","",IF(\'_OBRSpellMap\'!$G$441=0,VLOOKUP(C3,法术大全!A:X,26,FALSE),INDEX(法术大全!A:X,\'_OBRSpellMap\'!$G$441,26)))'
        edits['O8']=(old,old.replace(',26,FALSE',',24,FALSE').replace('$G$441,26)','$G$441,24)'))
    replacements={ref:replace_formula(cells[ref],*pair) for ref,pair in edits.items()}
    sheet=parts[part]
    for ref,raw in replacements.items():
        assert sheet.count(cells[ref])==1
        sheet=sheet.replace(cells[ref],raw,1)
    output=p.write_zip(seed,{part:sheet});np,ni,nc=p.read_zip(output)
    assert list(parts)==list(np) and comment==nc
    assert [key for key in parts if parts[key]!=np[key]]==[part]
    updated=p.indexed_cells(np[part]);assert cells.keys()==updated.keys()
    assert [ref for ref in cells if cells[ref]!=updated[ref]]==list(replacements)
    assert p.strip_elements(parts[part],'c')==p.strip_elements(np[part],'c')
    properties=('date_time','compress_type','comment','extra','create_system','create_version','extract_version','flag_bits','volume','internal_attr','external_attr')
    assert all(getattr(i,k)==getattr(j,k) for i,j in zip(infos,ni) for k in properties)
    target=destination/(version+'-SPELL-DISPLAY-NO-CACHE-NOT-FOR-UPLOAD.xlsx')
    with target.open('xb') as f:f.write(output)
    assert target.read_bytes()==output and original_path.read_bytes()==original and seed_path.read_bytes()==seed
    return {'source':str(original_path),'source_sha256':sha(original),'seed':str(seed_path),'seed_sha256':sha(seed),'output':str(target),'output_sha256':sha(output),
      'part':part,'edits':{ref:{'before':pair[0],'after':pair[1]} for ref,pair in edits.items()},'helper_formula':helper,'map_source_row_bindings':len(row_bindings),
      'same_sheet_non_target_cells_byte_exact':len(cells)-len(edits),'all_other_parts_byte_exact':True,'source_keys_and_helpers_unchanged':True,
      'zip_metadata_preserved':True,'source_files_unchanged':True,'bodies_applied':cfg['body_applied'],'native_calculated':False,'upload_ready':False}
