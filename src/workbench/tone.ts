const key='full-suite/ui-tone',nightKey='full-suite/ui-night',paletteKey='dnd-card/ui-palette:v1';
export function applyTone(value?:string|null){const color=value&&/^#[0-9a-f]{6}$/i.test(value)?value:'#50525B';document.documentElement.style.setProperty('--suite-tone',color);}
export function applyNightMode(value:boolean){document.documentElement.dataset.suiteNight=String(value);}
function applyPalette(){let ui:Record<string,string>={};try{ui=JSON.parse(localStorage.getItem(paletteKey)||'{}').ui||{};}catch{}const aliases:Record<string,string>={bg:'surface',bg1:'heading',bg2:'surface',text:'ink',muted:'muted',border:'line',accent:'accent','suite-paper':'surface','suite-surface':'heading','suite-ink':'ink','suite-muted':'muted','suite-line':'line','suite-tone':'accent'};for(const [name,key] of Object.entries(aliases)){const color=ui[key];if(/^#[0-9a-f]{6}$/i.test(color||''))document.documentElement.style.setProperty('--'+name,color);else document.documentElement.style.removeProperty('--'+name);}applyTone(ui.accent||localStorage.getItem(key));}
function restore(){try{applyTone(localStorage.getItem(key));applyNightMode(localStorage.getItem(nightKey)==='1');applyPalette();}catch{applyTone();applyNightMode(false);}}
restore();
window.addEventListener('storage',event=>{if(event.key===key||event.key===nightKey||event.key===paletteKey||event.key===null)restore();});
