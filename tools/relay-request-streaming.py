"""Change only the dev relay ingress; preserve all other nginx locations."""
import re

def streaming_config(text):
    pattern=r'(location\s*=\s*/suite-dev/relay\s*\{)([^}]*)(\})'
    matches=list(re.finditer(pattern,text))
    if len(matches)!=1:raise ValueError('Expected one dev relay location')
    match=matches[0];body=match[2]
    if not re.search(r'proxy_http_version\s+1\.1\s*;',body):raise ValueError('Relay requires HTTP/1.1 streaming')
    directives=list(re.finditer(r'proxy_request_buffering\s+\w+\s*;',body))
    if len(directives)>1:raise ValueError('Duplicate ingress buffering directive')
    if directives:body=re.sub(r'proxy_request_buffering\s+\w+\s*;','proxy_request_buffering off;',body)
    else:body='\n        proxy_request_buffering off;'+body
    return text[:match.start()]+match[1]+body+match[3]+text[match.end():]
