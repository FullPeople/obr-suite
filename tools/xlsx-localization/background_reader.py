"""A full-width background reader below the existing character-background form."""
import re
from xml.sax.saxutils import escape,quoteattr
import spell_bodies_package as p
from main_display_apply import attribute
from main_remaining_fields import layout_styles


def spec(version):
    last='BM' if version=='2014' else 'BO'
    feature='Background Feature' if version=='2014' else 'Background Description'
    benefits=[('Languages','S4'),('Skills','S5'),('Tools','S6'),('Equipment','S7')] if version=='2014' else [('Ability Scores','S4'),('Feat','AF4'),('Skills','S5'),('Tools','S6'),('Equipment','S7')]
    formula='&CHAR(10)&CHAR(10)&'.join('"'+name+': "&'+ref for name,ref in benefits)
    result={'first_row':39,'last_row':92,'last_column':last,'height':15,
            'cells':{'B39':{'text':'Full background details - Back to top','style_from':'AP4'},
                     'B40':{'formula':'IF(E6="","No background selected",E6)','style_from':'AP3'},
                     'B43':{'text':feature,'style_from':'AP3'},
                     'B44':{'formula':'AP4','style_from':'AP4'},
                     'B67':{'text':'Background Benefits','style_from':'AP3'},
                     'B68':{'formula':formula,'style_from':'AP4'}},
            'merges':['B39:'+last+'39','B40:'+last+'41','B43:'+last+'43','B44:'+last+'65','B67:'+last+'67','B68:'+last+'92'],
            'links':{'AP3':'B39','B39':'A1'},'font':'Arial','font_size':11,
            'link_style_from':'AP4','link_font_size':9}
    if version=='2014':
        result['last_row']=126
        result['cells'].update({'B94':{'text':'Background Description','style_from':'AP3'},'B95':{'formula':'背景数据!V2','style_from':'AP4'}})
        result['merges'] += ['B94:'+last+'94','B95:'+last+'126']
    return result


def apply(styles,content,planned):
    cells=p.indexed_cells(content);rows=p.spans(content,'row');assert max(int(a['r']) for a,*_ in rows)<planned['first_row']
    assert not p.spans(content,'hyperlinks')
    added=[]
    for row in range(planned['first_row'],planned['last_row']+1):
        body=[]
        for ref,value in planned['cells'].items():
            if int(ref[1:])!=row:continue
            style=p.fragment(cells[value['style_from']]).get('s')
            inner=('<f>'+escape(value['formula'])+'</f>') if 'formula' in value else ('<is><t>'+escape(value['text'])+'</t></is>')
            body.append('<c r="'+ref+'" s="'+style+'" t="'+('str' if 'formula' in value else 'inlineStr')+'">'+inner+'</c>')
        added.append('<row r="'+str(row)+'" ht="'+str(planned['height'])+'" customHeight="1">'+''.join(body)+'</row>')
    content=content.replace(b'</sheetData>',''.join(added).encode('utf8')+b'</sheetData>',1)
    refs=list(planned['cells']);styles,content=layout_styles(styles,content,{'refs':refs,'font':planned['font'],'size':planned['font_size'],'wrap_refs':refs,'widths':{}})
    # Hyperlinks are rendered blue by spreadsheet readers; use a white backing.
    current=p.indexed_cells(content)['AP3'];content=content.replace(current,attribute(current,'s',p.fragment(cells[planned['link_style_from']]).get('s')),1)
    styles,content=layout_styles(styles,content,{'refs':['AP3'],'font':planned['font'],'size':planned['link_font_size'],'wrap_refs':['AP3'],'widths':{}})
    merge=p.spans(content,'mergeCells')[0][1];merged=merge.replace(b'</mergeCells>',(''.join('<mergeCell ref="'+ref+'"/>' for ref in planned['merges'])+'</mergeCells>').encode('utf8'))
    content=content.replace(merge,attribute(merged,'count',int(p.fragment(merge).get('count'))+len(planned['merges'])),1)
    links=('<hyperlinks>'+''.join('<hyperlink ref='+quoteattr(ref)+' location='+quoteattr(target)+'/>' for ref,target in planned['links'].items())+'</hyperlinks>').encode('utf8')
    # Hyperlinks follow validations and precede page margins in worksheet order.
    margins=p.spans(content,'pageMargins')[0][1];content=content.replace(margins,links+margins,1)
    dim=p.spans(content,'dimension')[0][1];previous=p.fragment(dim).get('ref');assert re.fullmatch(r'A1:B[NP][0-9]+',previous)
    content=content.replace(dim,attribute(dim,'ref',re.sub(r'[0-9]+$',str(planned['last_row']),previous)),1)
    return styles,content
