import { renderEffect } from '../src/modules/textEffects/renderer';
import { DEFAULT_CONFIG, parseConfig, duration, entryTime, narrationTime } from '../src/modules/textEffects/model';
import * as catalog from '../src/modules/textEffects/catalog';
const root=document.getElementById('presentation')!;
let active:ReturnType<typeof renderEffect>|undefined;
(window as any).fixture={catalog,defaults:DEFAULT_CONFIG,mount(patch:any={},time?:number){active?.dispose();const config=parseConfig({...DEFAULT_CONFIG,...patch});if(!config)throw Error('Invalid fixture config');active=renderEffect(root,config,{time});return {duration:duration(config),arrival:config.startDelay+entryTime(config),exit:duration(config)-config.exit-config.endDelay,narration:narrationTime(config)};},seek(time:number){active?.seek(time);},dispose(){active?.dispose();}};