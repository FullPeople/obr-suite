"""Hidden formula mirrors and preserved lookup branches; no audit-path dependency."""
from pathlib import Path
import hashlib,io,json,posixpath,re,sys,zipfile,xml.etree.ElementTree as ET
from xml.parsers import expat
from xml.sax.saxutils import escape
from openpyxl.formula.tokenizer import Tokenizer
from openpyxl.formula.translate import Translator
from openpyxl.utils.cell import range_boundaries
if not __debug__:raise RuntimeError("Verification requires assertions; do not use -O")
sys.dont_write_bytecode=True
NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';Q=lambda x:'{'+NS+'}'+x
RNS='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
PINS={'2014':'a3f151c7b99ea9f339be5571f043025ed477978c74da77ef83eb8e37aec86fbf','2024':'555e25c5eb042afdc47c903650cb13ae6c8df43c02ceb50a1bfa28441402f4dd'}
LIMITS={'2014':524,'2024':811}
sha=lambda b:hashlib.sha256(b).hexdigest()
digest=lambda v:sha(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf8'))
PLAN=None;LABELS=None;SOURCE_PLAN_SHA=None
def configure(plan_path,label_directory):
    global PLAN,LABELS,SOURCE_PLAN_SHA
    PLAN=Path(plan_path).resolve();LABELS=Path(label_directory).resolve()
    SOURCE_PLAN_SHA=sha(PLAN.read_bytes())

def require(ok,message):
    if not ok:raise ValueError(message)

def xml(raw):
    require(b'<!DOCTYPE' not in raw.upper() and b'<!ENTITY' not in raw.upper(),'Unsupported XML declaration')
    return ET.fromstring(raw)

def node(raw):return xml(b'<r xmlns="'+NS.encode()+b'" xmlns:x="'+NS.encode()+b'">'+raw+b'</r>')[0]

def elements(raw,wanted):
    parser=expat.ParserCreate(namespace_separator='}');stack=[];found=[]
    def opened(name,attrs):
        a=parser.CurrentByteIndex;j=a;quote=None
        while j<len(raw):
            c=raw[j]
            if quote:
                if c==quote:quote=None
            elif c in (34,39):quote=c
            elif c==62:break
            j+=1
        stack.append((name,attrs,a,j+1,raw[j-1:j]==b'/'))
    def closed(name):
        n,attrs,a,head,selfclosed=stack.pop();require(n==name,'XML nesting')
        end=head if selfclosed else raw.index(b'>',parser.CurrentByteIndex)+1
        if name.split('}')[-1]==wanted:found.append((attrs,raw[a:end],a,end))
    parser.StartElementHandler=opened;parser.EndElementHandler=closed;parser.Parse(raw,True)
    return found

def cells(raw):
    records=elements(raw,'c');out={a['r']:b for a,b,_,_ in records};require(len(out)==len(records),'Duplicate cell');return out

def package(path):
    raw=Path(path).read_bytes()
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        infos=z.infolist();require(len(infos)==len({i.filename for i in infos}),'Duplicate package part')
        parts={i.filename:z.read(i) for i in infos};comment=z.comment
    return raw,parts,infos,comment

def sheets(parts):
    rels={r.get('Id'):r for r in xml(parts['xl/_rels/workbook.xml.rels'])};out={}
    for n in xml(parts['xl/workbook.xml']).find(Q('sheets')):
        rel=rels[n.get(RNS+'id')];target=rel.get('Target');require(rel.get('TargetMode')!='External','External sheet')
        part=target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target)
        require(part.startswith('xl/') and part in parts,'Invalid sheet part');require(n.get('name') not in out,'Duplicate sheet name')
        out[n.get('name')]={'part':part,'state':n.get('state','visible')}
    return out

def text(cell,strings):
    c=node(cell)
    if c.get('t')=='s':c=node(strings[int(c.findtext(Q('v'))) ][1])
    elif c.get('t') not in ('inlineStr','str'):return c.findtext(Q('v')) or ''
    if c.get('t')=='str':return c.findtext(Q('v')) or ''
    return ''.join(n.text or '' for n in c.iter(Q('t')))

def decode_formula(formula):
    """Only the approved literal/CHAR(10)/& grammar; no general evaluator."""
    require(formula.startswith('='),'Mirror equals prefix');s=formula[1:];i=0;chunks=[];literal_lengths=[]
    while i<len(s):
        if s.startswith('CHAR(10)',i):chunks.append('\n');i+=8
        elif s[i]=='"':
            start=i;i+=1;chunk=''
            while i<len(s):
                if s[i]=='"':
                    if i+1<len(s) and s[i+1]=='"':chunk+='"';i+=2;continue
                    i+=1;break
                chunk+=s[i];i+=1
            else:raise ValueError('Unclosed mirror literal')
            chunks.append(chunk);literal_lengths.append(len(s[start+1:i-1].encode('utf-16-le'))//2)
        else:raise ValueError('Unexpected mirror operation')
        if i<len(s):require(s[i]=='&','Mirror join');i+=1;require(i<len(s),'Trailing mirror join')
    require(bool(chunks),'Empty mirror formula');require(max(literal_lengths,default=0)<=240,'Mirror literal exceeds 240 UTF16')
    require(len(formula.encode('utf-16-le'))//2<=8192,'Mirror formula exceeds Excel length')
    return ''.join(chunks)

def formula_records(name,part,raw):
    cs=cells(raw);masters={}
    for addr,b in cs.items():
        f=node(b).find(Q('f'))
        if f is not None and f.get('t')=='shared' and f.text:masters[f.get('si')]=(addr,f.text)
    for addr,b in cs.items():
        f=node(b).find(Q('f'))
        if f is None:continue
        value=f.text
        if f.get('t')=='shared' and not value:
            origin,original=masters[f.get('si')];value=Translator('='+original,origin=origin).translate_formula(addr)[1:]
        if value:yield {'sheet':name,'part':part,'cell':addr,'formula':value,'attrs':dict(f.attrib)}

def calls(formula):
    tokens=Tokenizer('='+formula).items;spans=[];offset=0
    for t in tokens:
        start=offset
        if t.type=='WHITE-SPACE':
            while offset<len(formula) and formula[offset].isspace():offset+=1
        else:require(formula.startswith(t.value,offset),'Tokenizer spelling');offset+=len(t.value)
        spans.append((t,start,offset))
    require(offset==len(formula),'Tokenizer full coverage');out=[]
    for i,(t,start,end) in enumerate(spans):
        if t.type!='FUNC' or t.subtype!='OPEN':continue
        args=[];depth=0;argstart=end
        for child,a,b in spans[i+1:]:
            if child.type in ('FUNC','PAREN','ARRAY') and child.subtype=='OPEN':depth+=1
            elif child.type in ('FUNC','PAREN','ARRAY') and child.subtype=='CLOSE':
                if depth==0:args.append(formula[argstart:a]);out.append({'name':t.value[:-1].upper(),'args':args,'start':start,'end':b,'text':formula[start:b]});break
                depth-=1
            elif child.type=='SEP' and child.subtype=='ARG' and depth==0:args.append(formula[argstart:a]);argstart=b
    return out,spans

def reference(token,local):
    value=token.replace('$','');match=re.fullmatch(r"(?:(?:'([^']*(?:''[^']*)*)'|([^!]+))!)?([A-Z]+[1-9][0-9]*|[A-Z]+)(?::([A-Z]+[1-9][0-9]*|[A-Z]+))?",value)
    if not match:return None
    sheet=(match[1].replace("''", "'") if match[1] is not None else match[2]) or local
    address=match[3]+(':'+match[4] if match[4] else '')
    try:bounds=range_boundaries(address)
    except ValueError:return None
    return sheet,bounds

def scan(parts,book):
    records=[r for name,s in book.items() for r in formula_records(name,s['part'],parts[s['part']])];direct=[];unsupported=[];dictionary_count=0;map_j=[];edges=[]
    for rec in records:
        formula=rec['formula'];fcalls,spans=calls(formula);body_calls=[]
        for c in fcalls:
            args=c['args'];table=args[1] if c['name']=='VLOOKUP' and len(args)==4 else args[0] if c['name']=='INDEX' and len(args)>=3 else None
            if table and re.fullmatch(r"(?:'法术大全'|法术大全)!\$?A:\$?[A-Z]+",table):
                dictionary_count+=1
                if args[2]=='13':body_calls.append(c)
                elif not args[2].isdigit():unsupported.append({'record':rec,'reason':'dynamic lookup column'})
        for t,a,b in spans:
            if t.type!='OPERAND' or t.subtype!='RANGE':continue
            ref=reference(t.value,rec['sheet'])
            if not ref:continue
            sheet,(c1,r1,c2,r2)=ref
            if sheet=='法术大全' and c1<=13<=c2:
                covered=any(c['start']<=a and c['end']>=b and c['name'] in ('VLOOKUP','INDEX') for c in fcalls)
                if not covered:unsupported.append({'record':rec,'reason':'other dictionary M reference','reference':t.value})
            if sheet=='_OBRSpellMap' and c1<=10<=c2:map_j.append({'record':rec,'reference':t.value})
            for target_sheet,target_cell in [('主要','R84'),('数据表','BH12'),('数据表','BJ12'),('法术书','C23')]:
                tc,tr,_,_=range_boundaries(target_cell)
                if sheet==target_sheet and c1<=tc<=c2 and (r1 or 1)<=tr<=(r2 or 1048576):edges.append({'target':target_sheet+'!'+target_cell,'consumer':rec['sheet']+'!'+rec['cell'],'reference':t.value,'formula':formula})
        if body_calls:direct.append({**rec,'bodyCalls':body_calls})
    # Names and other XML formulas are scanned too; none may secretly refer to the mirror column or dictionary M.
    other_refs=[]
    for part,raw in parts.items():
        if not part.endswith('.xml') or part in {s['part'] for s in book.values()}:continue
        root=xml(raw)
        for n in root.iter():
            if n.tag.split('}')[-1] not in ('definedName','f','formula'):continue
            value=n.text or ''
            if '法术大全' in value or '_OBRSpellMap' in value:other_refs.append({'part':part,'tag':n.tag,'attributes':dict(n.attrib),'text':value})
    return {'formulaRecords':len(records),'dictionaryLookupCalls':dictionary_count,'direct':direct,'unsupported':unsupported,'existingMapJReferences':map_j,'immediateDownstream':edges,'otherPartReferences':other_refs}

def build():
    require(sha(PLAN.read_bytes())==SOURCE_PLAN_SHA,'Root mirror plan hash mismatch')
    source=json.loads(PLAN.read_text('utf8'));out={'schema':'obr-body-formula-mirror/v1','sourcePlanSha256':sha(PLAN.read_bytes()),'entries':source['entries'],'versions':{}}
    require(len(out['entries'])==1331,'Mirror entry count')
    for ver in ('2014','2024'):
        path=LABELS/f'{ver}-SPELLBOOK-LABELS-NO-CACHE-NOT-FOR-UPLOAD.xlsx';raw,parts,_,_=package(path);require(sha(raw)==PINS[ver],'Seed hash mismatch')
        book=sheets(parts);require(book['_OBRSpellMap']['state']=='veryHidden','Existing Map must remain veryHidden')
        map_part=book['_OBRSpellMap']['part'];mapxml=parts[map_part];mc=cells(mapxml);dimension=xml(mapxml).find(Q('dimension')).get('ref')
        columns=sorted({re.sub(r'\d+','',a) for a in mc});require(columns==['A','B','C','D','E','G'],'Unexpected existing map columns')
        endrow=621 if ver=='2014' else 864;require(dimension==f'A1:G{endrow}','Map dimension')
        ss=elements(parts['xl/sharedStrings.xml'],'si');dc=cells(parts[book['法术大全']['part']]);entries=[e for e in out['entries'] if e['version']==ver]
        require([e['cell'] for e in entries]==[f'M{r}' for r in range(3,LIMITS[ver]+1)],'Built-in body row coverage')
        for e in entries:
            require(digest(e['target'])==e['target_sha256'],'Mirror target hash');require(decode_formula(e['formula'])==e['target'],'Mirror roundtrip')
            require(text(dc[e['cell']],ss)==e['target'],'Seed static body differs');require('J'+e['cell'][1:] not in mc,'Occupied mirror target')
        inventory=scan(parts,book);require(not inventory['unsupported'],'Unclassified dictionary body consumer');require(not inventory['existingMapJReferences'],'Existing map J consumer')
        refs=inventory['otherPartReferences'];require(len(refs)==1,'Unexpected non-worksheet dictionary references')
        named=refs[0];filter_range=xml(parts[book['法术大全']['part']]).find(Q('autoFilter')).get('ref')
        require(named['part']=='xl/workbook.xml' and named['attributes']=={'name':'_xlnm._FilterDatabase','localSheetId':str(12 if ver=='2014' else 13),'hidden':'1'} and named['text'].replace('$','')=='法术大全!'+filter_range,'Unclassified non-worksheet dictionary reference')
        named['classification']='Existing hidden filter range; exact autoFilter range, unchanged and not a formula lookup consumer.'
        require({(r['sheet'],r['cell']) for r in inventory['direct']}=={('主要','R84'),('数据表','BH12' if ver=='2014' else 'BJ12'),('法术书','C23')},'Unexpected direct consumers')
        edits=[]
        for rec in inventory['direct']:
            cs=rec['bodyCalls'];require(len(cs)==2 and {c['name'] for c in cs}=={'INDEX','VLOOKUP'},'Direct consumer shape')
            idx=next(c for c in cs if c['name']=='INDEX');g=idx['args'][1];require(re.fullmatch(r"'_OBRSpellMap'!\$G\$(61|68|441)",g) is not None,'Unexpected row helper')
            target=f'IF(AND({g}>=3,{g}<={LIMITS[ver]}),INDEX(\'_OBRSpellMap\'!$J:$J,{g}),{idx["text"]})'
            formula=rec['formula'][:idx['start']]+target+rec['formula'][idx['end']:]
            old=cells(parts[rec['part']])[rec['cell']];require(node(old).find(Q('f')).attrib==({'ca':'1'} if rec['cell']=='C23' else {}),'Consumer formula metadata')
            edits.append({'sheet':rec['sheet'],'part':rec['part'],'cell':rec['cell'],'sourceFormula':rec['formula'],'targetFormula':formula,'oldCellSha256':sha(old),'helper':g})
        out['versions'][ver]={'seed':str(path),'seedSha256':sha(raw),'mapPart':map_part,'dictionaryPart':book['法术大全']['part'],'oldMapSha256':sha(mapxml),'oldDimension':dimension,'newDimension':f'A1:J{endrow}','lastBuiltin':LIMITS[ver],'existingColumns':columns,'edits':edits,'inventory':inventory}
    return out

def validate_author(path,plan):
    raw,parts,_,_=package(path);book=sheets(parts);require(set(book)=={'2014','2024'},'Author sheet set');ss=elements(parts.get('xl/sharedStrings.xml',b'<sst xmlns="'+NS.encode()+b'"/>'),'si');formulas={}
    for ver in ('2014','2024'):
        cs=cells(parts[book[ver]['part']]);entries=[e for e in plan['entries'] if e['version']==ver]
        require(set(cs)=={f'{col}{row}' for col in 'ABCD' for row in range(1,len(entries)+2)},'Author cell set')
        for col,label in zip('ABCD',['Record','Source cell','English body','Display formula']):require(text(cs[col+'1'],ss)==label,'Author header')
        for i,e in enumerate(entries,2):
            for col,v in zip('ABC',[e['id'],e['cell'],e['target']]):require(text(cs[f'{col}{i}'],ss)==v,'Author metadata/body mismatch')
            f=node(cs[f'D{i}']).findtext(Q('f'));require(f==e['formula'][1:],'Author formula mismatch');require(decode_formula('='+f)==e['target'],'Author formula content mismatch');formulas[(ver,e['cell'])]=f
    return {'sha256':sha(raw),'cells':(1331+2)*4,'formulas':formulas}

def replace_formula(cell,formula):
    spans=elements(cell,'f');require(len(spans)==1,'One consumer formula');_,old,a,b=spans[0]
    opening=old[:old.index(b'>')+1];closing=old[old.rindex(b'</'):]
    return cell[:a]+opening+escape(formula).encode('utf8')+closing+cell[b:]

def replace_cells(raw,changes):
    found=set()
    for attrs,old,a,b in reversed(elements(raw,'c')):
        addr=attrs['r']
        if addr in changes:raw=raw[:a]+changes[addr]+raw[b:];found.add(addr)
    require(found==set(changes),'Missing changed cell');return raw

def apply(parts,plan,ver,author):
    cfg=plan['versions'][ver];out=dict(parts)
    for edit in cfg['edits']:
        old=cells(out[edit['part']])[edit['cell']];require(sha(old)==edit['oldCellSha256'],'Consumer fingerprint mismatch')
        out[edit['part']]=replace_cells(out[edit['part']],{edit['cell']:replace_formula(old,edit['targetFormula'])})
    raw=parts[cfg['mapPart']];new={int(e['cell'][1:]):e for e in plan['entries'] if e['version']==ver};found=set()
    for attrs,row,a,b in reversed(elements(raw,'row')):
        r=int(attrs['r'])
        if r not in new:continue
        require(not row.endswith(b'/>'),'Unexpected empty map row');f=author['formulas'][(ver,'M'+str(r))]
        addition=f'<c r="J{r}" t="str"><f>{escape(f)}</f></c>'.encode('utf8');require(b'</row>' in row,'Map row closing');row=row.replace(b'</row>',addition+b'</row>');raw=raw[:a]+row+raw[b:];found.add(r)
    require(found==set(new),'Missing mirror rows')
    d=elements(raw,'dimension');require(len(d)==1,'Map dimension count');_,old,a,b=d[0];require(node(old).get('ref')==cfg['oldDimension'],'Map old dimension mismatch')
    raw=raw[:a]+old.replace(cfg['oldDimension'].encode(),cfg['newDimension'].encode())+raw[b:];out[cfg['mapPart']]=raw
    return out

def stripped(raw,tag):
    for _,_,a,b in reversed(elements(raw,tag)):raw=raw[:a]+raw[b:]
    return raw

def verify(before,after,plan,ver):
    cfg=plan['versions'][ver];require(set(before)==set(after),'Package part set');allowed={cfg['mapPart'],*(e['part'] for e in cfg['edits'])}
    require({p for p in before if before[p]!=after[p]}==allowed,'Changed part whitelist')
    expected={(e['part'],e['cell']):e for e in cfg['edits']};mirrors={'J'+e['cell'][1:]:e for e in plan['entries'] if e['version']==ver};old_count=0;formulas=0
    for part in before:
        if not re.fullmatch(r'xl/worksheets/sheet\d+\.xml',part):
            require(before[part]==after[part],'Non-worksheet preservation');continue
        bc=cells(before[part]);ac=cells(after[part]);old_count+=len(bc)
        require(set(ac)==set(bc)|(set(mirrors) if part==cfg['mapPart'] else set()),'Cell set whitelist')
        for addr,old in bc.items():
            edit=expected.get((part,addr));actual=ac[addr]
            if not edit:require(actual==old,'Non-target cell preservation')
            else:
                require(stripped(old,'f')==stripped(actual,'f'),'Consumer attributes/children preservation');require(node(old).find(Q('f')).attrib==node(actual).find(Q('f')).attrib,'Consumer formula attribute preservation');require(node(actual).findtext(Q('f'))==edit['targetFormula'],'Consumer formula mismatch')
        if part==cfg['mapPart']:
            normalized=after[part]
            for attrs,new,a,b in reversed(elements(normalized,'c')):
                if attrs['r'] not in mirrors:continue
                e=mirrors[attrs['r']];n=node(new);require(n.attrib=={'r':attrs['r'],'t':'str'},'Mirror attributes')
                require(len(n)==1 and n[0].tag==Q('f') and not n[0].attrib,'Mirror formula child')
                require(n[0].text==e['formula'][1:] and decode_formula('='+n[0].text)==e['target'],'Mirror formula mismatch');normalized=normalized[:a]+normalized[b:]
            normalized=normalized.replace(cfg['newDimension'].encode(),cfg['oldDimension'].encode(),1);require(normalized==before[part],'Map scaffolding preservation')
        else:require(stripped(before[part],'c')==stripped(after[part],'c'),'Worksheet scaffolding preservation')
        for raw in ac.values():
            n=node(raw)
            if n.find(Q('f')) is not None:formulas+=1;require(n.find(Q('v')) is None,'Formula cache present')
    return {'allOldCells':old_count,'unchangedOldCells':old_count-3,'changedConsumers':3,'newMirrorCells':len(mirrors),'formulaCellsWithoutCache':formulas,'changedParts':sorted(allowed),'allOtherBytesPreserved':True}
