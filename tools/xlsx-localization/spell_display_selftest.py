"""Rebuild from an isolated source closure and exercise meaningful input guards."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,re,shutil,subprocess,sys,zipfile
import xml.etree.ElementTree as ET
import spell_display_package as package

if not __debug__:raise RuntimeError('Do not run the self-test with -O')
sha=lambda b:hashlib.sha256(b).hexdigest()
REPO=package.REPO

def require(ok,message):
    if not ok:raise AssertionError(message)

def mutate_author(source,target,key,tag,change):
    target.mkdir(exist_ok=False)
    for name in ('body2014','body2024','labels','fields','mirrors','references'):
        shutil.copyfile(source/(name+'.xlsx'),target/(name+'.xlsx'))
    path=target/(key+'.xlsx')
    with zipfile.ZipFile(path) as z:
        infos=z.infolist();parts={i.filename:z.read(i) for i in infos};comment=z.comment
    part='xl/worksheets/sheet1.xml';raw=parts[part]
    match=re.search(rb'<x:c\b[^>]*\br="D2"[^>]*>.*?</x:c>',raw,re.S)
    require(match is not None,'Actual author D2 must exist')
    cell=match[0];inner=re.search(rb'<x:'+tag+rb'(?:\s[^>]*)?>(.*?)</x:'+tag+rb'>',cell,re.S)
    require(inner is not None,'Actual author target node must exist')
    replacement=change(inner[1]);require(replacement!=inner[1],'Mutation must alter actual content')
    changed=cell[:inner.start(1)]+replacement+cell[inner.end(1):]
    updated=raw[:match.start()]+changed+raw[match.end():]
    ET.fromstring(updated)
    replacement_path=target/(key+'-mutated.xlsx')
    with zipfile.ZipFile(replacement_path,'x') as z:
        z.comment=comment
        for info in infos:z.writestr(info,updated if info.filename==part else parts[info.filename])
    # This replaces only a disposable newly copied author fixture, never a card.
    path.write_bytes(replacement_path.read_bytes())
    return {'author':key,'cell':'D2','tag':tag.decode(),'validXML':True,'sourceSha256':sha((source/(key+'.xlsx')).read_bytes()),'mutantSha256':sha(path.read_bytes())}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node',type=Path,required=True);parser.add_argument('--artifact-runtime',type=Path,required=True)
    parser.add_argument('--marker',type=Path,required=True);args=parser.parse_args()
    for p in (args.node,args.marker):require(p.is_file(),'Missing explicit runtime tool')
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    out=package.BASE/('portable-selftest-'+stamp);out.mkdir(parents=True,exist_ok=False)
    plans=package.text_plans()
    # The loaded Python closure plus selected review data and original cards.
    needed={Path(m.__file__).resolve().relative_to(REPO).as_posix() for m in list(sys.modules.values())
            if getattr(m,'__file__',None) and Path(m.__file__).suffix=='.py'
            and Path(m.__file__).resolve().is_relative_to(REPO) and Path(m.__file__).resolve()!=Path(__file__).resolve()}
    needed.add('tools/xlsx-localization/author_display_targets.mjs')
    needed.add('tools/xlsx-localization/glossary.json')
    needed.update(plans['body2014']['review_hashes']);needed.update(plans['body2024']['review_hashes'])
    needed.update(('tools/xlsx-localization/reviewed.jsonl','tools/xlsx-localization/reviews/spellbook-display-001.jsonl','tools/xlsx-localization/reviews/spell-fields-fgl-001.jsonl'))
    needed.update('tools/xlsx-localization/reviews/'+name for name in package.references.REVIEWS)
    needed.update('public/'+package.body2014.planner.p.TEMPLATES[v] for v in ('2014','2024'))
    source=out/'source';source.mkdir()
    source_hashes={}
    for relative in sorted(needed):
        target=source/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(REPO/relative,target)
        source_hashes[relative]=sha(target.read_bytes())
    require(not (source/'tools/xlsx-localization/catalog.jsonl').exists(),'No catalog should be required')
    commands=[]
    def command(label,argv,ok=True,contains=None):
        print('Checking '+label,flush=True)
        log=out/(label+'.log')
        with log.open('xb') as f:r=subprocess.run([str(a) for a in argv],cwd=source,stdout=f,stderr=subprocess.STDOUT,timeout=600)
        text=log.read_text('utf8',errors='replace')
        require((r.returncode==0)==ok,label+': '+text[-1500:])
        if contains:require(contains in text,label+': wrong rejection reason')
        commands.append({'case':label,'exitCode':r.returncode,'expectedSuccess':ok,'logSha256':sha(log.read_bytes())})
        return text
    py=[sys.executable,'-B','-X','utf8','tools/xlsx-localization/spell_display_package.py']
    prepared=json.loads(command('prepare',py+['--prepare']).splitlines()[-1]);plan_dir=Path(prepared['output'])
    for key,expected in plans.items():require(json.loads((plan_dir/(key+'.json')).read_bytes())==expected,'Isolated plan differs: '+key)
    authors=out/'authors'
    command('marker',[args.node,args.marker,'--operation-kind','create','--expected-output-count','6','--output-format','xlsx'])
    command('author',[args.node,'tools/xlsx-localization/author_display_targets.mjs',plan_dir,authors,args.artifact_runtime])
    built=json.loads(command('build',py+['--author-directory',authors]).splitlines()[-1])
    for v,record in built['reports'].items():require(sha(Path(record['output']).read_bytes())==record['sha256']==package.FINAL_PINS[v],'Actual final package differs')
    unsafe=source/'public/display-plan-invalid'
    command('reject-output-scope',py+['--prepare','--output',unsafe],False,'Output must be a new child')
    require(not unsafe.exists(),'Rejected output was created')
    command('reject-existing-output',py+['--prepare','--output',plan_dir],False,'FileExistsError')
    optimized=[sys.executable,'-O','tools/xlsx-localization/spell_display_package.py','--prepare']
    command('reject-optimized-python',optimized,False,'Optimization mode is unsupported')
    mutations=[]
    bad_fields=out/'bad-fields';mutations.append(mutate_author(authors,bad_fields,'fields',b'v',lambda _:b'WRONG REVIEWED VALUE'))
    bad_out=source.parent/'_audit/xlsx-spell-display/display-candidate-bad-fields'
    command('reject-field-author',py+['--author-directory',bad_fields,'--output',bad_out],False,'Authored target')
    require(not bad_out.exists(),'Bad field input created a candidate')
    bad_mirrors=out/'bad-mirrors';mutations.append(mutate_author(authors,bad_mirrors,'mirrors',b'f',lambda x:x.replace(b'CHAR(10)',b'CHAR(11)',1)))
    bad_out=source.parent/'_audit/xlsx-spell-display/display-candidate-bad-mirrors'
    command('reject-mirror-author',py+['--author-directory',bad_mirrors,'--output',bad_out],False,'Author formula mismatch')
    require(not bad_out.exists(),'Bad mirror input created a candidate')
    bad_references=out/'bad-references';mutations.append(mutate_author(authors,bad_references,'references',b'v',lambda _:b'WRONG REFERENCE FIELD'))
    bad_out=source.parent/'_audit/xlsx-spell-display/display-candidate-bad-references'
    command('reject-reference-author',py+['--author-directory',bad_references,'--output',bad_out],False,'Authored target')
    require(not bad_out.exists(),'Bad reference input created a candidate')
    for name,pin in source_hashes.items():require(sha((source/name).read_bytes())==pin,'Isolated source changed: '+name)
    report={'commands':commands,'cliCalls':len(commands),'source':str(source),'sourceFiles':source_hashes,'output':built['output'],'reports':built['reports'],'authorHashes':built['author_hashes'],'mutations':mutations,'sourceUnchanged':True,'catalogRequired':False,'historicalAuditRequired':False,'actualNewAuthorExports':6,'nativeRecalculated':False,'releaseReady':False}
    package.write_json(out/'result.json',report)
    print(json.dumps({'output':str(out),'cliCalls':len(commands),'sourceFiles':len(source_hashes),'finalPackages':{v:r['sha256'] for v,r in built['reports'].items()},'passed':True},ensure_ascii=False))

if __name__=='__main__':main()
