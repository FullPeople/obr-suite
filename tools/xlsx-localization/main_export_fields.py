"""Correct proven main-card export coordinates without changing the JSON schema.

Only the two pinned templates and their reviewed main-display copies are
supported. Existing JSON escaping and overflow handling use the unchanged,
hash-checked export compiler. This stage is not a complete-card release.
"""
from collections import Counter
from pathlib import Path
import hashlib,json,re
import xml.etree.ElementTree as ET
import export_package as ep
import spell_bodies_package as p
import spell_display_mirrors as package_reader

if not __debug__:
    raise RuntimeError('Verification requires assertions; do not use -O')

g=ep.g
REPO=p.REPO
INPUTS={
    '2014':'f3b4b1edb499ca80a926e96e3f90dc5c467cd1180d40a61943045841c32b2f2f',
    '2024':'bfb0db4fbc0c61d96b75afbb73491f6436d284cd67add13208f99aba2f1e01b4',
}
CURRENCY={'AN60':'AP59','AG60':'AI59','AG61':'AI60','AG62':'AI61','AG63':'AI62'}
sha=lambda b:hashlib.sha256(b).hexdigest()

def require(ok,message):
    if not ok:raise ValueError(message)

def source_render(node):
    """Keep original reference spelling required by the compiler's header check."""
    if node.op=='ref':return node.value
    if node.op=='lit':return g.quoted(node.value) if isinstance(node.value,str) else g.as_text(node.value)
    if node.op=='fn':return str(node.value)+'('+','.join(source_render(n) for n in node.args)+')'
    return '('+node.op.join(source_render(n) for n in node.args)+')'

def replace_refs(node,mapping):
    if node.op=='ref' and node.value in mapping:return mapping[node.value]
    return g.Node(node.op,node.value,tuple(replace_refs(n,mapping) for n in node.args))

def filter_key(node):
    if node.op!='fn' or node.value.upper()!='IF' or len(node.args)!=3:return None
    condition=node.args[0]
    if condition.op!='=' or len(condition.args)!=2:return None
    left,right=condition.args
    if left.op=='ref' and right==g.lit(''):return left.value
    return None

def corrected_tree(tree,version):
    groups=Counter()
    def change(node):
        if node.op=='fn' and node.value.removeprefix('_xlfn.').upper()=='TEXTJOIN':
            keys=[filter_key(n) for n in node.args[2:]]
            if keys and keys[0]=='L42':
                require(keys==['L'+str(r) for r in range(42,53)],'Wondrous row structure changed')
                groups['wondrous']+=1
                # The actual ten-row table has no quantity column. Each listed
                # item represents one item; I42:I51 is the adjacent skills table.
                entries=[replace_refs(n,{'I'+str(r):g.lit('1')}) for r,n in zip(range(42,52),node.args[2:-1])]
                return g.Node('fn',node.value,node.args[:2]+tuple(entries))
            if keys and keys[0]=='L53':
                require(keys==['L'+str(r) for r in range(53,58)],'Consumable row structure changed')
                groups['consumables']+=1
                entries=[replace_refs(n,{'I'+str(r):g.Node('ref','AP'+str(r))}) for r,n in zip(range(53,58),node.args[2:])]
                return g.Node('fn',node.value,node.args[:2]+tuple(entries))
            if keys and keys[0]=='BT40':
                require(keys==['BT'+str(r) for r in range(40,46)],'Special-ability row structure changed')
                groups['special_abilities']+=1
                shift=7 if version=='2014' else 0
                entries=[]
                for r,n in zip(range(40,45),node.args[2:-1]):
                    entries.append(replace_refs(n,{col+str(r):g.Node('ref',col+str(r-shift)) for col in ('BT','BZ')}))
                return g.Node('fn',node.value,node.args[:2]+tuple(entries))
        return g.Node(node.op,node.value,tuple(change(n) for n in node.args))
    corrected=change(tree)
    require(groups==Counter(wondrous=1,consumables=1,special_abilities=1),'Expected export sections not found exactly once')
    refs=Counter(n.value for n in g.walk(corrected) if n.op=='ref')
    require(all(refs[c]==2 for c in CURRENCY) and refs['AS41']==1,'Currency/shield reference occurrence changed')
    corrected=replace_refs(corrected,{**{a:g.Node('ref',b) for a,b in CURRENCY.items()},'AS41':g.Node('ref','AS40')})
    return corrected

def verify_source_layout(raw,version):
    """Check the actual headers, merge anchors and editable input locations."""
    parts,_,_=p.read_zip(raw);sheet=parts['xl/worksheets/sheet2.xml'];root=ET.fromstring(sheet)
    cells=p.indexed_cells(sheet);strings=p.spans(parts[p.SST],'si')
    def text(ref):return package_reader.text(cells[ref],strings)
    for ref,want in {'L41':'奇物','P41':'同调','R41':'稀有度','U41':'部位','W41':'特性','L52':'消耗品','AP52':'数量','AG59':'GP','AN59':'PP','AG60':'EP','AG61':'SP','AG62':'CP'}.items():
        require(text(ref)==want,'Original table header changed: '+ref)
    special_start=33 if version=='2014' else 40
    require(text('BT'+str(special_start-2))=='特殊能力','Special-ability section moved')
    require(text('BT'+str(special_start-1))=='名称' and text('BZ'+str(special_start-1))=='描述','Special-ability column headers moved')
    merges={n.get('ref') for n in root.iter(p.q('mergeCell'))}
    xfs=ET.fromstring(parts['xl/styles.xml']).find(p.q('cellXfs'))
    inputs=[]
    for r in range(42,52):
        require('L'+str(r)+':O'+str(r) in merges and 'W'+str(r)+':AT'+str(r) in merges,'Wondrous row boundary changed')
        require(p.fragment(cells['I'+str(r)]).find(p.q('f')) is not None or r in (42,46),'Adjacent skill formula changed')
        inputs.extend([col+str(r) for col in ('L','P','R','U','W')])
    for r in range(53,58):
        require(f'AP{r}:AQ{r}' in merges and text('AR'+str(r))=='/','Quantity anchor changed')
        inputs.append('AP'+str(r))
    for r in range(special_start,special_start+5):
        require(f'BT{r}:BY{r}' in merges and f'BZ{r}:CO{r}' in merges,'Special-ability row boundary changed')
        inputs.extend(['BT'+str(r),'BZ'+str(r)])
    inputs.extend(CURRENCY.values())
    for ref in inputs:
        cell=p.fragment(cells[ref]);xf=xfs[int(cell.get('s','0'))];protection=xf.find(p.q('protection'))
        require(protection is not None and protection.get('locked')=='0','Input is no longer editable: '+ref)
    return {'actual_inputs_checked':len(inputs),'special_rows':[special_start,special_start+4],'wondrous_rows':[42,51],'quantity_current_column':'AP','quantity_secondary_column_unchanged':'AS'}

def plan(version):
    name,pin=ep.SOURCES[version];source_path=REPO/'public'/name;raw=source_path.read_bytes()
    require(sha(raw)==pin,'Original template changed')
    layout=verify_source_layout(raw,version)
    source=g.read_original(source_path);tree=corrected_tree(g.Formula(source['formula']).tree,version)
    formula='='+source_render(tree)
    require(g.Formula(formula).tree==tree,'Corrected source expression round trip changed')
    result=g.make_plan(formula,main_sheet=source['main_sheet'],sheet_names=source['sheet_names'])
    result['preserved_contract']['shield_equipped_source']='AS40, preserving the earlier shield correction'
    result['corrected_main_fields']={'source_sha256':pin,'layout':layout,'wondrous_quantity':'One item per row; no quantity input exists in this table','consumable_quantity':'Left quantity input AP; right AS remains unchanged and outside this existing JSON field','currency':{'pp':'AP59','gp':'AI59','ep':'AI60','sp':'AI61','cp':'AI62'}}
    result['entries']=[{'id':version+'!'+c['cell'],'version':version,'sheet':'Export','cell':c['cell'],'target':c['formula']} for c in result['add_sheet']['cells']]
    c=result['replace_cell'];result['entries'].append({'id':version+'!AV1','version':version,'sheet':'主要','cell':'AV1','target':c['formula']})
    return result

def apply(version,seed,planned,authored):
    require(sha(seed)==INPUTS[version],'Input is not the reviewed main-display copy')
    require(planned==plan(version),'Export plan differs from the verified original')
    p.authored_values(authored,planned['entries'])
    parts,_,_=p.read_zip(seed);sheets=package_reader.sheets(parts)
    main=sheets['主要']['part'];helper=sheets['Export']['part']
    require(sheets['Export']['state']=='hidden','Existing Export helper is not hidden')
    for name,data in parts.items():
        if name.endswith('.xml') and name not in (main,helper):
            require(not re.search(rb"(?:'Export'|\bExport)!",data),'Another part directly references an Export helper: '+name)
    cells=p.indexed_cells(parts[main]);av1=cells['AV1'];node=p.fragment(av1)
    require(node.find(p.q('v')) is None and len(node.findall(p.q('f')))==1,'Unexpected AV1 cache/formula')
    formula=b'<f>'+p.escape(planned['replace_cell']['formula'][1:]).encode('utf8')+b'</f>'
    changed,count=re.subn(rb'<f>.*?</f>',lambda _:formula,av1,count=1,flags=re.S);require(count==1,'Unsupported AV1 representation')
    require(p.strip_elements(changed,'f')==p.strip_elements(av1,'f'),'AV1 nonformula content changed')
    require(parts[main].count(av1)==1,'Ambiguous AV1 cell')
    output=p.write_zip(seed,{main:parts[main].replace(av1,changed,1),helper:ep.worksheet_xml(planned)})
    after,_,_=p.read_zip(output)
    require({n for n in parts if parts[n]!=after[n]}=={main,helper},'Change outside main AV1 and existing helper')
    now=p.indexed_cells(after[main]);require(now.keys()==cells.keys(),'Main cell set changed')
    require(all(now[r]==b for r,b in cells.items() if r!='AV1'),'Another main cell changed')
    actual=p.indexed_cells(after[helper]);require(len(actual)==len(planned['add_sheet']['cells']),'Helper cell count differs')
    for c in planned['add_sheet']['cells']:
        n=p.fragment(actual[c['cell']]);require(n.attrib=={'r':c['cell']} and len(n)==1 and n[0].tag==p.q('f') and n[0].text==c['formula'][1:],'Helper formula or cache differs')
    return output,{'sha256':sha(output),'bytes':len(output),'helper_cells':len(actual),'source':planned['corrected_main_fields'],'all_other_main_cells_and_parts_preserved':True,'native_calculation_performed':False,'release_ready':False}
