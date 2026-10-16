// Compile-only synthetic account-session profile; production files stay disabled.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,nextLoad){const result=nextLoad(url,context);if(new URL(url).pathname.endsWith('/src/cloud-availability.ts')){const source=typeof result.source==='string'?result.source:Buffer.from(result.source).toString('utf8'),needle='export const cloudFeaturesEnabled:boolean=false;';assert.equal(source.split(needle).length,2);return {...result,source:source.replace(needle,'export const cloudFeaturesEnabled:boolean=true;')};}return result;}});
