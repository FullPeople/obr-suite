"""Pinned main-card spell dropdown JSON plan; no workbook changes."""
from pathlib import Path
from datetime import datetime,timezone
import argparse
import hashlib,json,sys,types

sys.dont_write_bytecode=True
if not __debug__:
    raise RuntimeError("Optimization mode is unsupported; verification requires assertions")

def find_repo(explicit=None):
    selected=Path(explicit).resolve() if explicit else Path(__file__).resolve().parents[2]
    if not (selected/"tools/xlsx-localization/spell_identity.py").is_file():
        raise ValueError("Repository must contain the published localization tools")
    return selected


_bootstrap=argparse.ArgumentParser(add_help=False)
_bootstrap.add_argument("--repo")
REPO=find_repo(_bootstrap.parse_known_args()[0].repo)
TOOL_ROOT=REPO/"tools/xlsx-localization"
BASE=REPO.parent/"_audit/xlsx-spell-main-lists"


def allowed_output(directory,prefix):
    target=Path(directory).resolve();root=BASE.resolve()
    if target==root or root not in target.parents:
        raise ValueError("Output must be an exclusive child directory of "+str(root))
    if not target.name.startswith(prefix):
        raise ValueError("Output directory name must start with "+prefix)
    return target


PINS={"spell_identity.py":"aa56f587f88d27890e04df97bfe95349c33fcfd67e3347c26f6112d2655cf33f",
      "spell_lookup_plan.py":"54d4fe2c63b283bac0c773e48d6c02c1e2a485ca1f45c2f320267f6c5f6dcb03",
      "spell_selection_plan.py":"247d792c7123b7f43370e0e1dde82ba71c5a5d9303011aba8a51e4db331aa9ec"}


def load_dependencies():
    loaded={}
    for filename,pin in PINS.items():
        path=TOOL_ROOT/filename
        raw=path.read_bytes().replace(b"\r\n",b"\n")
        if hashlib.sha256(raw).hexdigest()!=pin:raise ValueError("Frozen dependency changed: "+filename)
        name=filename.removesuffix(".py")
        module=types.ModuleType(name);module.__file__=str(path);sys.modules[name]=module
        exec(compile(raw,str(path),"exec"),module.__dict__)
        if module.REPO.resolve()!=REPO:raise ValueError("Upstream repository differs; pass --repo explicitly")
        loaded[filename]=module
    return loaded["spell_selection_plan.py"]


selection=load_dependencies()


def build(version):
 base=selection.build_plan(version)
 sheet=selection.SELECT_SHEET
 quote=selection.qualified
 data=base['downstream']['mainCardChain']
 known=next(c for c in data if c['sheet']=='主要')['validations']
 expected_main='Q66:V73 Q77:V81 Y66:AD73 Y77:AD81 AG66:AL81 AO66:AT81'
 old_known=next(c for c in known if c['attributes']['sqref']==expected_main)
 rows=(2,201) if version=='2014' else (2,301)
 source_formulas={r['cell']:r['formula'] for c in data if c['sheet']=='数据表' for r in c['formulaRecords']}
 assert all('SMALL(' in source_formulas[f'K{r}'] and '&""' in source_formulas[f'K{r}'] for r in range(1,60))
 if version=='2024':
  assert all('SMALL(' in source_formulas[f'F{r}'] and '&""' in source_formulas[f'F{r}'] for r in range(2,302))
 groups=[{'name':'_OBRKnownSpellChoices','sourceSheet':'数据表','sourceColumn':'F','first':rows[0],'last':rows[1], 'choiceColumn':'H','countColumn':'I','total':'N1'},
  {'name':'_OBRPreparedSpellChoices','sourceSheet':'数据表','sourceColumn':'K','first':1,'last':59,'choiceColumn':'K','countColumn':'L','total':'N2'}]
 cells=[]; names=[]
 for group in groups:
  first,last=group['first'],group['last']; count=last-first+1
  output_last=count+2; choice=group['choiceColumn']; tally=group['countColumn']; total=group['total']
  source=quote(group['sourceSheet'],f"${group['sourceColumn']}${first}:${group['sourceColumn']}${last}")
  total_ref='$'+total[0]+'$'+total[1:]
  already_compact=group['sourceColumn']=='K' or version=='2024'
  group['reuseOriginalCompaction']=already_compact
  if already_compact:
   cells.append({'cell':total,'formula':f'SUMPRODUCT(N(LEN({source})>0))','type':'n'})
   names.append({'name':group['name'],'scope':'workbook','hidden':True,
    'formula':quote(group['sourceSheet'],f"${group['sourceColumn']}${first}")+':INDEX('+source+',MAX(1,'+quote(sheet,total_ref)+'))'})
   continue
  cells.append({'cell':total,'formula':f'${tally}${output_last}','type':'n'})
  for index in range(count):
   row=index+3; source_row=index+first
   ref=quote(group['sourceSheet'],f"${group['sourceColumn']}${source_row}")
   previous='0' if index==0 else f'${tally}${row-1}'
   cells.append({'cell':f'{tally}{row}','formula':f'{previous}+IF(LEN({ref})>0,1,0)','type':'n'})
   cells.append({'cell':f'{choice}{row}','formula':f'IF({index+1}<={total_ref},INDEX({source},MATCH({index+1},${tally}$3:${tally}${output_last},0)),"")','type':'str'})
  names.append({'name':group['name'],'scope':'workbook','hidden':True,
   'formula':quote(sheet,f'${choice}$3')+':INDEX('+quote(sheet,f'${choice}$3:${choice}${output_last}')+',MAX(1,'+quote(sheet,total_ref)+'))'})
 base_cells={c['cell'] for c in base['helperSheet']['cells']}
 assert not base_cells & {c['cell'] for c in cells}
 assert len(cells)==len({c['cell'] for c in cells})
 for cell in cells: selection.lookup.token_spans(cell['formula'])
 edits=[]
 for chain in data:
  for dv in chain['validations']:
   name='_OBRKnownSpellChoices' if dv['attributes']['sqref']==expected_main else '_OBRPreparedSpellChoices'
   assert name=='_OBRKnownSpellChoices' or dv['attributes']['sqref'] in ('B85:G85','BH4:BM4')
   edits.append({'sheet':chain['sheet'],'part':chain['part'],'sourcePartSha256':chain['partSha256'],
    'oldXML':dv['oldXML'],'oldXMLSha256':dv['oldXMLSha256'], 'preserveAllAttributes':True,
    'sqref':dv['attributes']['sqref'],'formula1':name})
 assert len(edits)==(3 if version=='2014' else 2)
 return {'schema':'obr-spell-main-lists-plan/v1','revision':'v2-reuse-existing-compaction','version':version,'source':base['source'],
  'selectionPlanSha256':selection.sha(selection.canonical(base)),
  'appendToSheet':sheet,'helperCells':cells,'definedNames':names,'groups':groups,
  'validationEdits':edits,'sourceChain':data,
  'preserveSourceFAndKFormulas':True,'preserveInputCoverageAndErrorBehavior':True,
  'workbookWritten':False,'nativeCalculated':False,
  'limits':['Existing F/K formula errors are not concealed or repaired.', 'Repeated selected spells retain order and duplicates.',
   '2014 source F2:F201 and 2024 source F2:F301 retain their original selection scope.',
   'Original known/prepared inputs, source arrays and shared ownership are unchanged; only DV formulas and separate helpers are planned.',
   'Native empty-list, selection, save/reopen and calculation cost remain unverified.']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo")
    parser.add_argument("--version",choices=("2014","2024","both"),default="both")
    parser.add_argument("--output",type=Path)
    args=parser.parse_args()
    stamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output=allowed_output(args.output or BASE/("main-lists-plan-"+stamp),"main-lists-plan-")
    output.mkdir(parents=True,exist_ok=False)
    reports={}
    for version in (("2014","2024") if args.version=="both" else (args.version,)):
        plan=build(version)
        target=output/(version+"-plan.json")
        with target.open("x",encoding="utf8",newline="\n") as f:json.dump(plan,f,ensure_ascii=False,indent=2);f.write("\n")
        reports[version]={"output":str(target),"planSha256":selection.sha(selection.canonical(plan))}
    print(json.dumps({"output":str(output),"versions":reports,"workbookWritten":False},ensure_ascii=False))


if __name__=="__main__":main()
