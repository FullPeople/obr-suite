import importlib.util,pathlib
path=pathlib.Path(__file__).with_name('relay-request-streaming.py')
spec=importlib.util.spec_from_file_location('streaming',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
base='location = /suite/relay { proxy_request_buffering on; }\nlocation = /suite-dev/relay {\n proxy_http_version 1.1;\n proxy_buffering off;\n}\nlocation /characters/ { root /var/www/characters; }'
updated=module.streaming_config(base)
assert 'location = /suite/relay { proxy_request_buffering on; }' in updated
assert 'location /characters/ { root /var/www/characters; }' in updated
assert updated.count('proxy_request_buffering off;')==1
assert module.streaming_config(updated)==updated
assert module.streaming_config(base.replace('proxy_buffering off;','proxy_request_buffering on;')).count('proxy_request_buffering off;')==1
for invalid in ['location = /suite-dev/relay {}',base+base]:
 try:module.streaming_config(invalid)
 except ValueError:pass
 else:raise AssertionError('Ambiguous config must fail')
print('PASS dev relay streaming scope and idempotence')
