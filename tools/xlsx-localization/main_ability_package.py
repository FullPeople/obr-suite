"""Build the reviewed English ability-input increment without saving source cards."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,json
import main_ability_inputs as fields

if not __debug__:raise RuntimeError('Verification requires assertions; do not use -O')
BASE=fields.R.parent/'_audit/xlsx-main-ability-inputs'


def fresh(value,prefix):
    out=Path(value).resolve() if value else BASE/(prefix+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    if not (out.is_relative_to(BASE.resolve()) and out!=BASE.resolve() and out.name.startswith(prefix)):
        raise ValueError('Output must be a new '+prefix+' directory in '+str(BASE))
    if out.exists():raise FileExistsError(str(out))
    return out


def write_json(path,value):
    with path.open('x',encoding='utf8',newline='\n') as f:json.dump(value,f,ensure_ascii=False,indent=2);f.write('\n')


def run(input2014,input2024,prepare=False,author_path=None,output=None):
    out=fresh(output,'ability-plan-' if prepare else 'ability-candidate-')
    paths={'2014':Path(input2014).resolve(),'2024':Path(input2024).resolve()}
    seeds={v:p.read_bytes() for v,p in paths.items()};planned=fields.plan(seeds)
    if prepare:
        out.mkdir(parents=True,exist_ok=False);write_json(out/'plan.json',planned)
        return {'output':str(out),'plan':str(out/'plan.json'),'entries':len(planned['entries'])}
    author_file=Path(author_path).resolve();author=author_file.read_bytes()
    products=fields.apply(seeds,planned,author)
    if not all(path.read_bytes()==seeds[v] for v,path in paths.items()) or author_file.read_bytes()!=author:
        raise ValueError('Input changed while generating')
    out.mkdir(parents=True,exist_ok=False);reports=[]
    for version,(raw,report) in products.items():
        path=out/(version+'-ABILITY-INPUTS-NO-CACHE-NOT-FOR-UPLOAD.xlsx')
        with path.open('xb') as f:f.write(raw)
        if path.read_bytes()!=raw:raise ValueError('Written candidate differs')
        report['path']=str(path);reports.append(report)
    write_json(out/'result.json',{'versions':reports,'author_sha256':fields.sha(author),'source_files_unchanged':True,'release_ready':False})
    return {'output':str(out),'versions':reports,'release_ready':False}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-2014',required=True);parser.add_argument('--input-2024',required=True)
    parser.add_argument('--prepare',action='store_true');parser.add_argument('--authored-targets');parser.add_argument('--output')
    args=parser.parse_args()
    if args.prepare and args.authored_targets:parser.error('--prepare does not take authored targets')
    if not args.prepare and not args.authored_targets:parser.error('Build needs --authored-targets')
    print(json.dumps(run(args.input_2014,args.input_2024,args.prepare,args.authored_targets,args.output),ensure_ascii=False))
