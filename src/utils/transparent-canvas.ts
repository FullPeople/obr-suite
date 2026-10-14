type CanvasTheme={mode:'LIGHT'|'DARK'};
type ThemeSource={getTheme:()=>Promise<CanvasTheme>;onChange:(fn:(theme:CanvasTheme)=>void)=>()=>void};
/** The UA canvas must use Owlbear's actual mode, not a saved Suite preset or OS preference. */
export function bindTransparentCanvas(theme:ThemeSource,root:HTMLElement=document.documentElement){
 let changed=false,active=true;
 const apply=(value:CanvasTheme)=>{
  if(!active||!['LIGHT','DARK'].includes(value.mode))return;
  const scheme=value.mode==='DARK'?'dark':'light';
  root.style.setProperty('color-scheme',scheme,'important');
  root.dataset.suiteCanvasScheme=scheme;
 };
 // Subscribe first: a slow initial read must not overwrite a newer host change.
 const stop=theme.onChange(value=>{changed=true;apply(value);});
 void theme.getTheme().then(value=>{if(!changed)apply(value);}).catch(error=>console.warn('[transparent-canvas] host mode read failed',error));
 return()=>{active=false;stop();};
}
