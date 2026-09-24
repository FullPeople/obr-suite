const key='full-suite/ui-tone',nightKey='full-suite/ui-night';
export function applyTone(value?:string|null){const color=value&&/^#[0-9a-f]{6}$/i.test(value)?value:'#50525B';document.documentElement.style.setProperty('--suite-tone',color);}
export function applyNightMode(value:boolean){document.documentElement.dataset.suiteNight=String(value);}
function restore(){try{applyTone(localStorage.getItem(key));applyNightMode(localStorage.getItem(nightKey)==='1');}catch{applyTone();applyNightMode(false);}}
restore();
window.addEventListener('storage',event=>{if(event.key===key||event.key===nightKey||event.key===null)restore();});
