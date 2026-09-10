"""Prepare exact author inputs and regenerate integrated English spell displays.

The build uses the two original cards, published reviewed body generators and
six explicitly supplied author workbooks. No historical audit file is read.
Output stays in a fresh sibling audit directory, never the public templates.
"""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,sys
import spell_bodies_package as body2014
import spell_bodies_2024_package as body2024
import spell_display_names as names
import spell_display_labels as labels
import spell_display_fields as fields
import spell_display_mirrors as mirrors
import spell_reference_fields as references

if not __debug__:raise RuntimeError('Verification requires assertions; do not use -O')
sys.dont_write_bytecode=True
REPO=body2014.REPO
BASE=REPO.parent/'_audit/xlsx-spell-display'
sha=lambda b:hashlib.sha256(b).hexdigest()
PARTIAL='obr-xlsx-partial-text-candidate/v1'
DISPLAY_PINS={'2014':'2d309ace76918f998609d81f61db14209884bbd138d5cee4ad6f591bd45944bb','2024':'de413faabdcf615cf9d33504bfd2dedc9ebd020de7369e3b4df4cd38c06d9e7f'}
FINAL_PINS={'2014':'0525d863f26c9464cdf1b32464e5c9f72d28556d8783f17c8a7211e20fefca5b','2024':'9e27efda3e0bd31a53c867cda30088bcc77c11946528b934088fa0c6d502039b'}

def require(ok,message):
    if not ok:raise ValueError(message)

def progress(message):
    print(message,file=sys.stderr,flush=True)

def fresh_output(directory,prefix):
    target=Path(directory).resolve() if directory else BASE/(prefix+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    require(target!=BASE.resolve() and target.is_relative_to(BASE.resolve()),'Output must be a new child of '+str(BASE))
    require(target.name.startswith(prefix),'Output name must start with '+prefix)
    if target.exists():raise FileExistsError(str(target))
    return target

def check_modules():
    for module in (body2014,body2024,names,labels,fields,mirrors,references):
        require(Path(module.__file__).resolve().parent==REPO/'tools/xlsx-localization','Run the entry point from the selected repository')
    require(body2024.REPO==REPO,'Rule-set repositories differ')

def reviewed_words(module,expected_count,actual):
    raw=module.REVIEW.read_bytes()
    require(sha(raw)==module.REVIEW_SHA,'Review file differs: '+module.REVIEW.name)
    rows=[json.loads(line) for line in raw.decode('utf8').splitlines() if line.strip()]
    require(len(rows)==expected_count,'Review record count')
    for row in rows:
        record=actual[row['version']][row['id']]
        require(all(row[k]==record[k] for k in ('kind','sheet','source','context')),'Review source/context differs')
        require(row['locations']==[o['location'] for o in record['occurrences']],'Review occurrence differs')
        require(row['source_sha256']==body2014.digest(row['source']),'Review source digest differs')
        require(row['dependency_review']=='pending' and row['application_approved'] is False and row['reviewed_by'],'Review metadata differs')
        require(isinstance(row['target'],str) and row['target'],'Missing reviewed target')
    return {'schema':PARTIAL,'entries':[{**r,'cell':r['locations'][0]} for r in rows],'review_sha256':sha(raw),'release_ready':False}

def project(text):
    require(isinstance(text,str) and text and '\r' not in text,'Unsupported body text')
    pieces=[]
    for n,line in enumerate(text.split('\n')):
        if n:pieces.append('CHAR(10)')
        chunk=''
        for char in line:
            if len((chunk+char).replace('"','""').encode('utf-16-le'))//2>240:
                require(bool(chunk),'Literal boundary');pieces.append('"'+chunk.replace('"','""')+'"');chunk=''
            chunk+=char
        pieces.append('"'+chunk.replace('"','""')+'"')
    formula='='+'&'.join(pieces)
    require(mirrors.decode_formula(formula)==text,'Projected body differs')
    return formula

def text_plans():
    check_modules()
    planners={'body2014':body2014.planner.build(),'body2024':body2024.planner.build_plan()}
    prep=body2014.planner.p
    glossary_path=REPO/'tools/xlsx-localization/glossary.json';glossary=glossary_path.read_bytes();actual={}
    for version in ('2014','2024'):
        _,rows,_=prep.inspect_xlsx(REPO/'public'/prep.TEMPLATES[version],version,json.loads(glossary))
        actual[version]={r['id']:r for r in rows}
    planners['labels']=reviewed_words(labels,42,actual)
    planners['fields']=reviewed_words(fields,3993,actual)
    planners['fields']['entries'].sort(key=lambda r:(r['version'],int(r['cell'][1:]),r['cell'][0]))
    projected=[]
    for key in ('body2014','body2024'):
        for e in planners[key]['entries']:
            projected.append({'version':e['version'],'id':e['id'],'cell':e['cell'],'target':e['target'],'target_sha256':e['target_sha256'],'formula':project(e['target'])})
    require(len(projected)==1331,'Mirror coverage')
    planners['mirrors']={'schema':'obr-body-formula-author/v1','entries':projected,'release_ready':False}
    planners['references']=references.plan()
    require(glossary_path.read_bytes()==glossary,'Glossary changed during preparation')
    return planners

def write_json(path,value):
    with path.open('x',encoding='utf8',newline='\n') as f:json.dump(value,f,ensure_ascii=False,indent=2);f.write('\n')

def prepare(directory=None):
    out=fresh_output(directory,'display-plan-');plans=text_plans();out.mkdir(parents=True,exist_ok=False)
    records={}
    for key,plan in plans.items():
        path=out/(key+'.json');write_json(path,plan)
        records[key]={'file':path.name,'sha256':sha(path.read_bytes()),'entries':len(plan['entries'])}
    manifest={'schema':'obr-spell-display-author-inputs/v1','plans':records,'release_ready':False}
    write_json(out/'manifest.json',manifest)
    return {'output':str(out),'plans':records}

def exact_write(path,raw):
    with path.open('xb') as f:f.write(raw)
    require(path.read_bytes()==raw,'Written package differs')

def run(author_directory,directory=None):
    check_modules();out=fresh_output(directory,'display-candidate-')
    progress('Checking the reviewed source and six author workbooks')
    author_root=Path(author_directory).resolve()
    author_paths={k:author_root/(k+'.xlsx') for k in ('body2014','body2024','labels','fields','mirrors','references')}
    author_raw={k:p.read_bytes() for k,p in author_paths.items()}
    fresh_plans=text_plans()
    # Verify actual author values before creating any candidate directory.
    for key in ('labels','fields','references'):body2014.authored_values(author_raw[key],fresh_plans[key]['entries'])
    contexts={'2014':body2014.load_context(author_paths['body2014']),'2024':body2024.load_context(author_paths['body2024'])}
    mirror_author=mirrors.validate_author(author_paths['mirrors'],fresh_plans['mirrors'])
    out.mkdir(parents=True,exist_ok=False)
    progress('Rebuilding the shared workbook helpers from the original cards')
    upstream=body2014.main_lists.run()
    stages={name:out/name for name in ('bodies','names','labels')}
    for stage in stages.values():stage.mkdir()
    body_paths={};body_reports={}
    for version,module in [('2014',body2014),('2024',body2024)]:
        progress(version+': applying and checking the complete reviewed bodies')
        if version=='2014':
            source,plan,targets,binding,author_path,author_bytes,glossary=contexts[version]
        else:
            source,plan,author_path,author_bytes,targets=contexts[version]
            binding={'validated_by_fresh_source_review_plan':True}
        incoming=Path(upstream['reports'][version]['output']);seed=module.pinned(incoming,module.PINS['seed'])
        output=module.apply(seed,plan,targets);evidence=module.verify(seed,output,plan)
        target=stages['bodies']/(version+'-SPELL-BODIES-NO-CACHE-NOT-FOR-UPLOAD.xlsx');exact_write(target,output)
        body_paths[version]=target;body_reports[version]={'sha256':sha(output),'bindings':binding,'preservation':evidence}
        require(module.SOURCE.read_bytes()==source and incoming.read_bytes()==seed,'Body source changed')
    name_cfg=names.configuration(body_paths)
    progress('Applying canonical names and reviewed spellbook labels')
    name_reports={v:names.build(v,cfg,stages['names']) for v,cfg in name_cfg.items()}
    labels.configure({v:r['output'] for v,r in name_reports.items()});label_plan=labels.build_plan()
    body2014.authored_values(author_raw['labels'],label_plan['entries'])
    label_paths={};label_reports={}
    for version,cfg in labels.CFG.items():
        output,evidence=labels.apply(version,cfg['seed'].read_bytes(),label_plan)
        target=stages['labels']/(version+'-SPELLBOOK-LABELS-NO-CACHE-NOT-FOR-UPLOAD.xlsx');exact_write(target,output)
        label_paths[version]=target;label_reports[version]={'sha256':sha(output),'preservation':evidence}
    fields.configure(label_paths);field_plan=fields.build_plan()
    body2014.authored_values(author_raw['fields'],field_plan['entries'])
    write_json(out/'label-application-plan.json',label_plan);write_json(out/'field-application-plan.json',field_plan)
    mirror_source=out/'mirror-source-plan.json';write_json(mirror_source,fresh_plans['mirrors'])
    progress('Binding the hidden body formulas to the actual display consumers')
    mirrors.configure(mirror_source,stages['labels']);mirror_plan=mirrors.build()
    require(mirror_plan['entries']==fresh_plans['mirrors']['entries'],'Mirror author plan changed')
    write_json(out/'mirror-application-plan.json',mirror_plan)
    reports={}
    for version in ('2014','2024'):
        progress(version+': verifying the complete integrated package')
        seed=label_paths[version].read_bytes();parts,_,_=body2014.read_zip(seed)
        field_output,field_evidence=fields.apply(version,seed,field_plan)
        fp=body2014.read_zip(field_output)[0]
        mp=mirrors.apply(parts,mirror_plan,version,mirror_author);mirror_evidence=mirrors.verify(parts,mp,mirror_plan,version)
        field_delta={p for p in parts if parts[p]!=fp[p]};mirror_delta={p for p in parts if parts[p]!=mp[p]}
        require(not field_delta&mirror_delta,'Overlapping display modifications')
        final=body2014.write_zip(field_output,{p:mp[p] for p in mirror_delta})
        require(sha(final)==DISPLAY_PINS[version],'Integrated display seed differs from the independently reviewed candidate')
        final,reference_evidence=references.apply(version,final,fresh_plans['references'])
        require(sha(final)==FINAL_PINS[version],'Reference-field output differs from the independently reviewed and native-tested candidate')
        target=out/(version+'-SPELL-DISPLAY-INTEGRATED-NO-CACHE-NOT-FOR-UPLOAD.xlsx');exact_write(target,final)
        reports[version]={'output':str(target),'sha256':sha(final),'field_preservation':field_evidence,'mirror_preservation':mirror_evidence,'reference_preservation':reference_evidence}
    require(text_plans()==fresh_plans,'Selected source or reviews changed during application')
    for k,path in author_paths.items():require(path.read_bytes()==author_raw[k],'Author file changed')
    result={'output':str(out),'upstream':upstream['output'],'body_reports':body_reports,'name_reports':name_reports,'label_reports':label_reports,'reports':reports,'author_hashes':{k:sha(v) for k,v in author_raw.items()},'native_recalculated_by_this_run':False,'native_evidence_equivalence':'Exact binary equality to the reviewed integrated candidate; native diagnostics are separate.','upload_ready':False,'release_ready':False}
    write_json(out/'result.json',result)
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--repo');parser.add_argument('--output',type=Path)
    modes=parser.add_mutually_exclusive_group(required=True);modes.add_argument('--prepare',action='store_true');modes.add_argument('--author-directory',type=Path)
    args=parser.parse_args()
    print(json.dumps(prepare(args.output) if args.prepare else run(args.author_directory,args.output),ensure_ascii=False))

if __name__=='__main__':main()
