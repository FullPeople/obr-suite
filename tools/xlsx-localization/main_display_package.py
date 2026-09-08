"""Generate the reviewed main-card captions from pinned spell-display copies.

This offline stage uses two independent author tables. It never imports an
original card into an authoring library or overwrites a public template.
"""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,sys
import spell_bodies_package as p
import main_display_apply as transform

if not __debug__:raise RuntimeError('Verification requires assertions; do not use -O')
REPO=p.REPO
HERE=REPO/'tools/xlsx-localization'
BASE=REPO.parent/'_audit/xlsx-main-display'
LAYOUT_SHA='8a211bd3461df468bf98a672da3ae7e5a1fe53bf36530b5f8ca22d9295e479fb'
sha=lambda b:hashlib.sha256(b).hexdigest()

def require(ok,message):
    if not ok:raise ValueError(message)

def load_layout():
    raw=(HERE/'main_display_layout.json').read_bytes()
    require(sha(raw.replace(b'\r\n',b'\n'))==LAYOUT_SHA,'Reviewed layout changed')
    layout=json.loads(raw);require(layout['schema']=='obr-main-display-layout/v1','Layout schema')
    reviews={}
    for name,pin in layout['reviews'].items():
        data=(HERE/name).read_bytes()
        require(sha(data.replace(b'\r\n',b'\n'))==pin,'Reviewed source changed: '+name)
        for line in data.decode('utf8').splitlines():
            row=json.loads(line);require(row['id'] not in reviews,'Duplicate source review');reviews[row['id']]=row
    glossary=json.loads((HERE/'glossary.json').read_bytes());prep=p.planner.p;actual={}
    for version,cfg in layout['labels']['versions'].items():
        source=REPO/'public'/prep.TEMPLATES[version]
        require(sha(source.read_bytes())==cfg['source_sha256'],'Original workbook changed')
        _,rows,_=prep.inspect_xlsx(source,version,glossary);actual[version]={r['id']:r for r in rows}
    checked=set()
    for entry in layout['labels']['entries']:
        row=reviews[entry['id']];record=actual[entry['version']][entry['id']]
        require(row['version']==entry['version'] and row['sheet']=='主要' and row['target']==entry['target'],'Located label review differs')
        require(all(row[k]==record[k] for k in ('source','kind','sheet','context')),'Original label context differs')
        require(row['locations']==[o['location'] for o in record['occurrences']],'Original label occurrences differ')
        require(row['source_sha256']==p.digest(row['source']) and row['workbook_sha256']==layout['labels']['versions'][entry['version']]['source_sha256'],'Original label fingerprint differs')
        require(row['dependency_review']=='pending' and row['application_approved'] is False and row['reviewed_by'] and row['note'],'Language review metadata differs')
        checked.add(entry['id'])
    expected_cells={}
    for version,cfg in layout['labels']['versions'].items():
        for item in cfg['statics']:
            row=reviews[item['id']]
            require(item['id'] in checked and item['cell'] in row['locations'] and item['source']==row['source'] and item['target']==row['target'],'Selected caption source differs')
            expected_cells[(version,item['cell'])]=item
        for item in cfg['messages']:
            row=reviews[item['id']]
            require(row['kind']=='validation_message' and row['source']==item['before'] and row['target']==item['after'],'Prompt source differs')
            require(row['locations']==['validation:'+str(item['old_index'])+':prompt'],'Prompt original ordinal differs')
    seen=set()
    for entry in layout['captions']['entries']:
        require(entry['id'] not in seen,'Duplicate caption author ID');seen.add(entry['id'])
        row=reviews[entry['review_id']]
        require(entry['review_id'] in checked and row['version']==entry['version'] and row['source']==entry['source'] and row['target']==entry['full_target'],'Full label for caption differs')
        if 'prompt_index' in entry:
            require(entry['target']==entry['full_target'],'Input hints are not shortened')
        else:
            item=expected_cells[(entry['version'],entry['cell'])]
            require(item['id']==entry['review_id'] and 8<=entry['font_size']<=10 and isinstance(entry['bold'],bool),'Caption typography or cell differs')
    require(len(layout['labels']['entries'])==407 and len(seen)==454 and len(expected_cells)==433,'Main display scope differs')
    return layout

def fresh_output(value,prefix):
    path=Path(value).resolve() if value else BASE/(prefix+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    require(path!=BASE.resolve() and path.is_relative_to(BASE.resolve()) and path.name.startswith(prefix),'Output must be a new '+prefix+' directory inside '+str(BASE))
    if path.exists():raise FileExistsError(str(path))
    return path

def write_json(path,value):
    with path.open('x',encoding='utf8',newline='\n') as f:json.dump(value,f,ensure_ascii=False,indent=2);f.write('\n')

def prepare(output=None):
    out=fresh_output(output,'main-plan-');layout=load_layout();out.mkdir(parents=True,exist_ok=False);files={}
    for key in ('labels','captions'):
        plan={'schema':'obr-xlsx-partial-text-candidate/v1','entries':layout[key]['entries'],'release_ready':False}
        file=out/(key+'.json');write_json(file,plan);files[key]={'file':file.name,'sha256':sha(file.read_bytes()),'entries':len(plan['entries'])}
    write_json(out/'manifest.json',{'schema':'obr-main-display-author-inputs/v1','plans':files,'release_ready':False})
    return {'output':str(out),'plans':files}

def build(input2014,input2024,author_directory,output=None):
    out=fresh_output(output,'main-candidate-');layout=load_layout();paths={'2014':Path(input2014).resolve(),'2024':Path(input2024).resolve()}
    originals={v:path.read_bytes() for v,path in paths.items()}
    for version,data in originals.items():require(sha(data)==layout['labels']['versions'][version]['seed_sha256'],'Input must be the reviewed spell-display copy for '+version)
    author_root=Path(author_directory).resolve();authors={}
    for key in ('labels','captions'):
        data=(author_root/(key+'.xlsx')).read_bytes();p.authored_values(data,layout[key]['entries']);authors[key]=sha(data)
    # Validate all actual inputs and authors before creating a candidate folder.
    products={};reports={}
    for version,data in originals.items():
        labeled,label_report=transform.apply_labels(version,data,layout['labels'])
        require(sha(labeled)==layout['expected_labels'][version],'Full label stage differs from the reviewed candidate')
        final,caption_report=transform.apply_captions(version,labeled,layout)
        require(sha(final)==layout['expected_captions'][version],'Caption stage differs from the natively checked candidate')
        products[version]=final;reports[version]={'sha256':sha(final),'bytes':len(final),'labels':label_report,'captions':caption_report}
    require(all(path.read_bytes()==originals[v] for v,path in paths.items()),'Input changed during generation')
    out.mkdir(parents=True,exist_ok=False)
    for version,data in products.items():
        file=out/(version+'-MAIN-DISPLAY-NO-CACHE-NOT-FOR-UPLOAD.xlsx')
        with file.open('xb') as f:f.write(data)
        require(file.read_bytes()==data,'Written candidate differs');reports[version]['path']=str(file)
    result={'output':str(out),'versions':reports,'authors':authors,'release_ready':False,'native_calculation_repeated':False,'originals_unchanged':True}
    write_json(out/'result.json',result)
    return {'output':str(out),'versions':{v:{k:r[k] for k in ('path','sha256','bytes')} for v,r in reports.items()},'release_ready':False}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare',action='store_true');parser.add_argument('--input-2014');parser.add_argument('--input-2024');parser.add_argument('--author-directory');parser.add_argument('--output')
    args=parser.parse_args()
    if args.prepare:
        if any((args.input_2014,args.input_2024,args.author_directory)):parser.error('--prepare takes no input or author paths')
        result=prepare(args.output)
    else:
        if not all((args.input_2014,args.input_2024,args.author_directory)):parser.error('Build requires --input-2014, --input-2024 and --author-directory')
        result=build(args.input_2014,args.input_2024,args.author_directory,args.output)
    print(json.dumps(result,ensure_ascii=False))
