"""Localize the feet suffix without converting numeric cells into text."""
import json,hashlib,xml.etree.ElementTree as E
import prepare
import spell_bodies_package as p
from main_toggle_fields import ORIGINALS
from main_ability_inputs import tabs
from main_display_apply import attribute
R=p.REPO
if not __debug__:raise RuntimeError('Verification requires assertions')
PINS={'2014':'382cce1b1e3958cd14b89b6f668309a8f594edfd2e1e1b735a734cf80b228e2d','2024':'c86f98a32348bbfdb47faeadc6fcb84fef6dcc7d76276bbc86a80e7f17692e2e'}
sha=lambda b:hashlib.sha256(b).hexdigest()

def plan(seeds):
    assert set(seeds)==set(PINS) and all(sha(raw)==PINS[v] for v,raw in seeds.items()),'Input is not the reviewed remaining-main card'
    reviews=[json.loads(s) for s in (R/'tools/xlsx-localization/reviews/number-formats-001.jsonl').read_text(encoding='utf8').splitlines()]
    assert len(reviews)==2 and len({r['id'] for r in reviews})==2
    glossary=json.loads((R/'tools/xlsx-localization/glossary.json').read_bytes());entries=[]
    for version,raw in seeds.items():
        source=R/'public'/ORIGINALS[version][0];assert sha(source.read_bytes())==ORIGINALS[version][1]
        _,records,_=prepare.inspect_xlsx(source,version,glossary);r=next(r for r in reviews if r['version']==version);record=next(n for n in records if n['id']==r['id'])
        assert all(r[k]==record[k] for k in ['source','kind','sheet','context']) and r['kind']=='format_literal' and r['source']=='0"尺"' and r['target']=='0" ft."'
        assert r['locations']==[n['location'] for n in record['occurrences']] and r['source_sha256']==prepare.digest(r['source']) and r['workbook_sha256']==ORIGINALS[version][1]
        assert r['reviewed_by'] and r['note'] and r['dependency_review']=='pending' and r['application_approved'] is False
        parts,_,_=p.read_zip(raw);styles=E.fromstring(parts['xl/styles.xml']);formats=[n for n in styles.find(p.q('numFmts')) if n.get('numFmtId')=='176'];assert len(formats)==1 and formats[0].get('formatCode')==r['source']
        assert not any(n.get('numFmtId')=='176' for n in styles.find(p.q('dxfs')).iter(p.q('numFmt')))
        xfs=list(styles.find(p.q('cellXfs')));users={}
        for name,part in tabs(parts).items():
            root=E.fromstring(parts[part])
            refs=[c.get('r') for c in root.iter(p.q('c')) if xfs[int(c.get('s','0'))].get('numFmtId')=='176']
            if refs:users[name]=refs
            for local,key in [('row','s'),('col','style')]:
                assert not any(xfs[int(n.get(key))].get('numFmtId')=='176' for n in root.iter(p.q(local)) if n.get(key) is not None),'Unexpected inherited unit format'
        assert users=={'主要':['AR22','AS22','AT22','AR24','AS24','AT24'],'盟友与魔宠':['W4','X4','Y4','Z4','AA4','AB4','AC4','BY4','BZ4','CA4','CB4','CC4','CD4','CE4']}
        entries.append({'id':version+'-feet-format','version':version,'sheet':'Number formats','cell':'176','kind':'format','source':r['source'],'target':r['target'],'review_id':r['id'],'users':users})
    return {'schema':'obr-number-format-plan/v1','entries':entries,'inputs':PINS,'release_ready':False}

def apply(seeds,planned,author):
    assert planned==plan(seeds),'Plan differs from pinned source and review';p.authored_values(author,planned['entries']);products={}
    for v,raw in seeds.items():
        parts,_,_=p.read_zip(raw);e=next(e for e in planned['entries'] if e['version']==v)
        content=parts['xl/styles.xml'];selected=[b for a,b,*_ in p.spans(content,'numFmt') if a.get('numFmtId')=='176'];assert len(selected)==1
        old=selected[0];new=attribute(old,'formatCode',e['target']);assert content.count(old)==1
        product=p.write_zip(raw,{'xl/styles.xml':content.replace(old,new,1)});after,_,_=p.read_zip(product)
        assert list(after)==list(parts) and {n for n in parts if parts[n]!=after[n]}=={'xl/styles.xml'}
        assert after['xl/styles.xml'].replace(new,old,1)==parts['xl/styles.xml']
        products[v]=(product,{'version':v,'sha256':sha(product),'bytes':len(product),'changed_parts':['xl/styles.xml'],'all_cells_formulas_and_styles_unchanged_except_feet_format':True,'release_ready':False})
    return products
