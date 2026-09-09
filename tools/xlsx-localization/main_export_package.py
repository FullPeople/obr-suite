"""Prepare and apply the proven main-card export field corrections offline."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json
import main_export_fields as fields

if not __debug__:raise RuntimeError('Verification requires assertions; do not use -O')
BASE=fields.REPO.parent/'_audit/xlsx-main-export'
sha=lambda b:hashlib.sha256(b).hexdigest()

def fresh(value,prefix):
    out=Path(value).resolve() if value else BASE/(prefix+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    fields.require(out.is_relative_to(BASE.resolve()) and out!=BASE.resolve() and out.name.startswith(prefix),'Output must be a new '+prefix+' directory in '+str(BASE))
    if out.exists():raise FileExistsError(str(out))
    return out

def write_json(path,value):
    with path.open('x',encoding='utf8',newline='\n') as f:json.dump(value,f,ensure_ascii=False,indent=2);f.write('\n')

def prepare(output=None):
    out=fresh(output,'export-plan-');plans={v:fields.plan(v) for v in ('2014','2024')}
    out.mkdir(parents=True,exist_ok=False);files={}
    for v,plan in plans.items():
        path=out/(v+'.json');write_json(path,plan);files[v]={'file':path.name,'sha256':sha(path.read_bytes()),'entries':len(plan['entries'])}
    write_json(out/'manifest.json',{'schema':'obr-main-export-author-inputs/v1','plans':files,'release_ready':False})
    return {'output':str(out),'plans':files}

def build(input2014,input2024,author_directory,output=None):
    out=fresh(output,'export-candidate-');paths={'2014':Path(input2014).resolve(),'2024':Path(input2024).resolve()}
    seeds={v:f.read_bytes() for v,f in paths.items()};authors={v:(Path(author_directory)/(v+'.xlsx')).read_bytes() for v in paths}
    for v,data in seeds.items():fields.require(sha(data)==fields.INPUTS[v],'Input is not the reviewed main-display copy for '+v)
    plans={v:fields.plan(v) for v in paths}
    for v in paths:fields.p.authored_values(authors[v],plans[v]['entries'])
    products={};reports={}
    for v,data in seeds.items():products[v],reports[v]=fields.apply(v,data,plans[v],authors[v])
    fields.require(all(f.read_bytes()==seeds[v] for v,f in paths.items()),'Input changed during generation')
    out.mkdir(parents=True,exist_ok=False)
    for v,data in products.items():
        path=out/(v+'-MAIN-EXPORT-FIELDS-NO-CACHE-NOT-FOR-UPLOAD.xlsx')
        with path.open('xb') as f:f.write(data)
        fields.require(path.read_bytes()==data,'Written candidate differs');reports[v]['path']=str(path)
    write_json(out/'result.json',{'versions':reports,'authors':{v:sha(a) for v,a in authors.items()},'source_files_unchanged':True,'release_ready':False})
    return {'output':str(out),'versions':{v:{k:r[k] for k in ('path','sha256','bytes','helper_cells')} for v,r in reports.items()},'release_ready':False}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--prepare',action='store_true');parser.add_argument('--input-2014');parser.add_argument('--input-2024');parser.add_argument('--author-directory');parser.add_argument('--output');args=parser.parse_args()
    if args.prepare:
        if any((args.input_2014,args.input_2024,args.author_directory)):parser.error('--prepare takes no workbook or author inputs')
        result=prepare(args.output)
    else:
        if not all((args.input_2014,args.input_2024,args.author_directory)):parser.error('Build needs both inputs and an author directory')
        result=build(args.input_2014,args.input_2024,args.author_directory,args.output)
    print(json.dumps(result,ensure_ascii=False))
