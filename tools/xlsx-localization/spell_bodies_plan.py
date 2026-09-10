"""Located 2014 reviewed spell-body JSON plan; no workbook changes.

The build function is mechanically preserved from the audited body plan.
Review status remains dependency pending; this tool does not approve release.
"""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,re,sys,types,zipfile
import xml.etree.ElementTree as ET

sys.dont_write_bytecode=True
if not __debug__:
    raise RuntimeError("Optimization mode is unsupported; verification requires assertions")
sha=lambda b:hashlib.sha256(b).hexdigest()

def find_repo(explicit=None):
    selected=Path(explicit).resolve() if explicit else Path(__file__).resolve().parents[2]
    if not (selected/"tools/xlsx-localization/spell_identity.py").is_file():
        raise ValueError("Repository must contain the published localization tools")
    return selected


_bootstrap=argparse.ArgumentParser(add_help=False)
_bootstrap.add_argument("--repo")
REPO=find_repo(_bootstrap.parse_known_args()[0].repo)
TOOL_ROOT=REPO/"tools/xlsx-localization"
BASE=REPO.parent/"_audit/xlsx-spell-bodies"


def allowed_output(directory,prefix):
    target=Path(directory).resolve();root=BASE.resolve()
    if target==root or root not in target.parents:
        raise ValueError("Output must be an exclusive child directory of "+str(root))
    if not target.name.startswith(prefix):
        raise ValueError("Output directory name must start with "+prefix)
    return target


def load(path,pin,name):
    # Hash the exact normalized bytes that will be compiled, also on CRLF checkouts.
    raw=path.read_bytes().replace(b"\r\n",b"\n")
    if sha(raw)!=pin:raise ValueError("Frozen dependency changed: "+path.name)
    module=types.ModuleType(name);module.__file__=str(path);sys.modules[name]=module
    exec(compile(raw,str(path),"exec"),module.__dict__)
    if hasattr(module,"REPO") and module.REPO.resolve()!=REPO:
        raise ValueError("Upstream repository differs; pass --repo explicitly")
    return module

PREPARE_SHA="9c21aca1bc86e4124ee435118d51d797a42d3c5f1b2016ce7902ea4f586cc748"
p=load(TOOL_ROOT/"prepare.py",PREPARE_SHA,"spell_bodies_prepare")
SOURCE_SHA="94444fda4206d579125418b0007b89c414b86c27d6b98655f81f3f1ce65e8fe6"
PART='xl/worksheets/sheet13.xml'
SI=re.compile(rb'<si\b[^>]*>.*?</si>',re.S)
CELL=re.compile(rb'<c\b[^>]*\br="([^"]+)"[^>]*?(?:/>|>.*?</c>)',re.S)


def build():
 source_path=REPO/'public'/p.TEMPLATES['2014']; source=source_path.read_bytes()
 assert sha(source)==SOURCE_SHA
 paths=[REPO/'tools/xlsx-localization/reviewed.jsonl',*sorted((REPO/'tools/xlsx-localization/reviews').glob('2014-*.jsonl'))]
 review_hashes={str(path.relative_to(REPO)):sha(path.read_bytes()) for path in paths}
 reviews=[json.loads(line) for path in paths for line in path.read_text('utf8').splitlines() if line.strip()]
 glossary=json.loads((REPO/'tools/xlsx-localization/glossary.json').read_text('utf8'))
 structure,records,_=p.inspect_xlsx(source_path,'2014',glossary)
 records={record['id']:record for record in records}
 selected={}
 for review in reviews:
  if review['version']!='2014' or review['sheet']!='法术大全' or review['kind']!='cell_text':continue
  refs=[ref for ref in review['locations'] if re.fullmatch(r'M\d+',ref)]
  if not refs:continue
  current=records[review['id']]
  assert all(review[key]==current[key] for key in ('source','kind','sheet','context'))
  assert review['source_sha256']==p.digest(current['source']) and review['workbook_sha256']==SOURCE_SHA
  assert review['locations']==[o['location'] for o in current['occurrences']]
  assert review['dependency_review']=='pending' and review['application_approved'] is False
  assert review['target'].strip() and not p.CJK.search(review['target'])
  assert len(review['target'].encode('utf-16-le'))//2<=32767
  for ref in refs:
   assert ref not in selected and all(o['part']==PART for o in current['occurrences'])
   selected[ref]=review
 assert set(selected)=={'M'+str(r) for r in range(3,525)},'All 522 builtin body rows must be reviewed'
 with zipfile.ZipFile(source_path) as z:
  strings=list(SI.finditer(z.read('xl/sharedStrings.xml')))
  cells={m[1].decode():m[0] for m in CELL.finditer(z.read(PART))}
  entries=[]
  for ref,review in sorted(selected.items(),key=lambda pair:int(pair[0][1:])):
   raw_cell=cells[ref];node=ET.fromstring(raw_cell)
   assert node.get('t')=='s' and node.find('f') is None
   raw_si=strings[int(node.findtext('v'))][0]
   si=ET.fromstring(raw_si)
   texts=si.findall('t')+si.findall('r/t')
   assert ''.join(t.text or '' for t in texts)==review['source']
   runs=si.findall('r');run_targets=None
   if runs:
    assert ref=='M209' and review['id']=='75c55701c4d43f1e1e5e63be' and len(si)==len(runs)==4
    assert review['source_sha256']=='12d3e281cdd381ed4a840cd88e70fed0901f8a242088ca4e75d69ee925199e6b'
    assert p.digest(review['target'])=='6613d39370ec99840e7ba33e73af11f08b9dd6be01eb31594f2f883c5e4fd7f7'
    assert [run.findtext('t') for run in runs][::2]==['•','•']
    lines=review['target'].splitlines(keepends=True)
    assert len(lines)==2 and all(line.startswith('• ') for line in lines) and lines[0].endswith('\n')
    run_targets=['•',lines[0][1:],'•',lines[1][1:]]
    assert ''.join(run_targets)==review['target']
   else:assert len(si)==1 and si[0].tag=='t'
   entries.append({'id':review['id'],'version':'2014','sheet':'法术大全','part':PART,'cell':ref,
    'source':review['source'],'target':review['target'],'source_sha256':review['source_sha256'],'target_sha256':p.digest(review['target']),
    'sourceCellSha256':sha(raw_cell),'sourceSharedStringSha256':sha(raw_si),'sourceSharedIndex':int(node.findtext('v')),
    'runTargets':run_targets,'reviewBatch':review['batch']})
 assert sum(e['runTargets'] is not None for e in entries)==1
 assert source_path.read_bytes()==source and all(sha((REPO/path).read_bytes())==digest for path,digest in review_hashes.items())
 return {'schema':'obr-xlsx-partial-text-candidate/v1','increment':'2014-all-builtin-spell-bodies/v1','version':'2014',
  'workbook_hashes':{'2014':SOURCE_SHA},'review_hashes':review_hashes,'entries':entries,
  'sourceFilename':source_path.name,'sourcePartSha256':structure['parts'][PART],
  'applicationScope':'Translate only reviewed static M3:M524 values. Preserve A/N keys, every other field, custom-slot formulas and all formula definitions. Existing identity map E is explicitly a fingerprint of original source fields, not of translated display fields.',
  'richTextScope':'M209 only: the two literal bullet runs and their Courier New properties stay in place; each matching full paragraph is translated inside the corresponding original FangSong run. No run properties are flattened or reordered.',
  'release_ready':False,'nativeCalculated':False,'limitations':['This is a body-only engineering increment, not a complete English card.','Formula references return translated bodies after native recalculation; calculation, layout, server identity and upload remain unverified.']}


def run(directory=None):
    stamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output=allowed_output(directory or BASE/("spell-bodies-plan-"+stamp),"spell-bodies-plan-")
    if output.exists():raise FileExistsError(str(output))
    source=REPO/"public"/p.TEMPLATES["2014"]
    if sha(source.read_bytes())!=SOURCE_SHA:raise ValueError("Source workbook changed before planning")
    plan=build()
    output.mkdir(parents=True,exist_ok=False)
    target=output/"2014-body-plan.json"
    with target.open("x",encoding="utf8",newline="\n") as f:f.write(json.dumps(plan,ensure_ascii=False,indent=2)+"\n")
    return {"output":str(output),"plan":str(target),"planFileSha256":sha(target.read_bytes()),
            "entries":len(plan["entries"]),"workbookWritten":False,"nativeCalculated":False,"uploadReady":False}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo")
    parser.add_argument("--output",type=Path)
    args=parser.parse_args()
    print(json.dumps(run(args.output),ensure_ascii=False))


if __name__=="__main__":main()
