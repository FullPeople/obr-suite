export const NATIVE_CANVAS_PAGES=[
 'boss-bar.html','boss-bar-v294.html','initiative-panel.html','initiative-panel-v294.html','hp-bar.html',
 'timestop-overlay.html','text-effect-display.html','transition-display.html','dice-effect.html',
 'initiative-combat-effect.html','supporter-overlay.html',
] as const;
/** Owlbear's native window factory uses the default iframe canvas. Keep that
 * contract separate from documents embedded explicitly in a dark outer page. */
export function nativeCanvasPath(path:string){
 const at=path.search(/[?#]/),file=at<0?path:path.slice(0,at),tail=at<0?'':path.slice(at);
 return NATIVE_CANVAS_PAGES.some(name=>file===name)?file.replace(/\.html$/,'-native.html')+tail:path;
}
