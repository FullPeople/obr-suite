"""Finite export regressions against the actual pinned template formulas.

These checks model supplied input values; native recalculation is separate.
"""
import copy,json,unittest
import main_export_fields as m

class MainExportFields(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.versions={}
        for v,(name,_) in m.ep.SOURCES.items():
            source=m.g.read_original(m.REPO/'public'/name)
            old=m.g.make_plan(source['formula'],main_sheet=source['main_sheet'],sheet_names=source['sheet_names'])
            cls.versions[v]=(source,old,m.plan(v))

    def seed(self,v):
        values=dict(self.versions[v][0]['values']);values['主要','AS40']='No'
        return values

    def expected(self,v,values):
        text=lambda ref:m.g.as_text(values.get(('主要',ref)))
        number=lambda ref:values.get(('主要',ref)) if type(values.get(('主要',ref))) in (int,float) else 0
        result=json.loads(m.g.evaluate_plan(self.versions[v][1],values))
        start=33 if v=='2014' else 40
        result['features']['special_abilities']=[{'name':text('BT'+str(r)),'desc':text('BZ'+str(r))} for r in range(start,start+5) if text('BT'+str(r))]
        result['wondrous']=[{'name':text('L'+str(r)),'qty':'1','attuned':text('P'+str(r)),'rarity':text('R'+str(r)),'slot':text('U'+str(r)),'props':text('W'+str(r))} for r in range(42,52) if text('L'+str(r))]
        result['consumables']=[{'name':text('L'+str(r)),'qty':text('AP'+str(r)),'rarity':text('R'+str(r)),'desc':text('U'+str(r))} for r in range(53,58) if text('L'+str(r))]
        result['currency']={'pp':number('AP59'),'gp':number('AI59'),'ep':number('AI60'),'sp':number('AI61'),'cp':number('AI62')}
        result['combat']['shield']['equipped']=text('AS40')
        return result

    def actual(self,v,values):return json.loads(m.g.evaluate_plan(self.versions[v][2],values))

    def fill(self,v):
        values=self.seed(v);start=33 if v=='2014' else 40
        for r in range(42,52):
            for col in ('L','P','R','U','W'):values['主要',col+str(r)]=f'{col}{r} "quoted" \\ 中文\nNext\tfield'
            values['主要','I'+str(r)]=1000+r
        for r in range(53,58):
            for col in ('L','R','U'):values['主要',col+str(r)]=f'{col}{r} "name"\nSecond line'
            values['主要','AP'+str(r)]=r-53
            values['主要','AS'+str(r)]=200+r
            values['主要','I'+str(r)]=-1000-r
        for r in range(start,start+5):
            values['主要','BT'+str(r)]=f'Feature {r}'
            values['主要','BZ'+str(r)]='Detail "quote"\\\nTab\tControl\x01'
        for ref,value in [('AP59',13),('AI59',29),('AI60',41),('AI61',53),('AI62',67)]:values['主要',ref]=value
        return values

    def test_untouched_card_has_no_header_items_or_familiar_features(self):
        for v in self.versions:
            with self.subTest(version=v):
                values=self.seed(v);actual=self.actual(v,values)
                expected=copy.deepcopy(self.versions[v][0]['cached_json'])
                expected['wondrous']=[];expected['features']['special_abilities']=[]
                expected['combat']['shield']['equipped']='No'
                self.assertEqual(actual,expected)

    def test_every_real_row_and_field_escapes_and_preserves_unrelated_data(self):
        for v in self.versions:
            with self.subTest(version=v):
                values=self.fill(v);actual=self.actual(v,values)
                self.assertEqual(actual,self.expected(v,values))
                self.assertEqual(len(actual['wondrous']),10)
                self.assertEqual(len(actual['consumables']),5)
                self.assertEqual(len(actual['features']['special_abilities']),5)
                self.assertEqual(actual['consumables'][0]['qty'],'0')
                self.assertEqual(actual['currency'],{'pp':13,'gp':29,'ep':41,'sp':53,'cp':67})

    def test_clearing_middle_rows_keeps_order_and_last_real_row(self):
        for v in self.versions:
            with self.subTest(version=v):
                values=self.fill(v);start=33 if v=='2014' else 40
                for ref in ('L43','L49','L54','L56','BT'+str(start+1),'BT'+str(start+3)):values['主要',ref]=''
                actual=self.actual(v,values);self.assertEqual(actual,self.expected(v,values))
                self.assertEqual([len(actual['wondrous']),len(actual['consumables']),len(actual['features']['special_abilities'])],[8,3,3])
                self.assertEqual(actual['wondrous'][-1]['name'],values['主要','L51'])

    def test_skill_values_and_nonentry_rows_do_not_become_inventory(self):
        for v in self.versions:
            with self.subTest(version=v):
                values=self.fill(v);before=self.actual(v,values)
                for r in range(42,58):values['主要','I'+str(r)]='Misleading adjacent skill'
                for ref in ('L52','R52','U52','W52','BT45','BZ45'):values['主要',ref]='A name outside the real table'
                for r in range(53,58):values['主要','AS'+str(r)]=9999
                self.assertEqual(self.actual(v,values),before)

    def test_currency_keeps_original_numeric_guard(self):
        for v in self.versions:
            for value,want in [(0,0),(None,0),('',0),('9',0),(True,0),(-7,-7),(1.5,1.5)]:
                with self.subTest(version=v,value=value):
                    values=self.seed(v)
                    for ref in ('AP59','AI59','AI60','AI61','AI62'):values['主要',ref]=value
                    actual=self.actual(v,values)
                    self.assertEqual(actual['currency'],{key:want for key in ('pp','gp','ep','sp','cp')})

    def test_prior_shield_input_and_stable_machine_header(self):
        for v in self.versions:
            values=self.seed(v);values['主要','AS40']='Yes';values['主要','AS41']='wrong cell'
            actual=self.actual(v,values)
            self.assertEqual(actual['combat']['shield']['equipped'],'Yes')
            self.assertEqual(actual['schema'],'obr-suite-card/v1')
            self.assertEqual(actual['meta']['ruleset'],'5E'+v)

if __name__=='__main__':unittest.main(verbosity=2)
