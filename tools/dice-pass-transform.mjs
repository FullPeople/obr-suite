// Test-build-only substitutions. Every boundary is exact and fails closed on source drift.
export const PRODUCT_BASE = '2e2ddb1f642e1375cffda45efad9584b33100008';
export const WEB_REF = '05dcfdb645339cac9f68d1f6009f44b7e63d5c25';
export const VARIANTS = ['baseline-before','no-GL-pass','no-2D-raster','no-detached-DOM','no-GL+no-2D','baseline-after'];
export function variantFlags(variant) {
  if (!VARIANTS.includes(variant) && variant !== 'baseline-dual' && variant !== 'baseline-trace') throw Error('Unknown diagnostic variant: '+variant);
  return {noGL:variant==='no-GL-pass'||variant==='no-GL+no-2D',no2D:variant==='no-2D-raster'||variant==='no-GL+no-2D',noDetachedDOM:variant==='no-detached-DOM'};
}
function replaceOnce(code, before, after, label) {
  if (code.split(before).length !== 2) throw Error('Dice pass diagnostic boundary changed: '+label);
  return code.replace(before, after);
}
export function transformSource(source, id, runtimePath) {
  const file=id.replaceAll('\\','/');let code=source;
  const replace=(before,after,label)=>{code=replaceOnce(code,before,after,file+': '+label);};
  if(file.endsWith('/extensions/workbench-dice3d/src/controller.ts')) {
    replace('const seed=crypto.getRandomValues(new Uint32Array(1))[0];','const seed=(globalThis as any).__dicePassConfig?.seed??crypto.getRandomValues(new Uint32Array(1))[0];','fixed physics seed');
  } else if(file.endsWith('/src/workbench/dice3d.ts')) {
    replace('const id=compat?.rollId||crypto.randomUUID();','const id=compat?.rollId||(globalThis as any).__dicePassConfig?.rollId||crypto.randomUUID();','fixed particle roll id');
  } else if(file.endsWith('/src/workbench/dice3d-verify.ts')) {
    replace('events.push(e.data)','events.push({...e.data,observedAt:performance.timeOrigin+performance.now()})','SDK event observation');
  } else if(file.endsWith('/extensions/workbench-dice3d/src/renderer.ts')) {
    code=`import {installDicePassBudget} from ${JSON.stringify(runtimePath)};\n`+code;
    replace('    this.resetMetrics();\n  }','    this.resetMetrics();installDicePassBudget(this);\n  }','install after original warmup');
    replace('const age=(time-a.start)/1000;if(age<0)continue;','const age=(time-a.start)/1000;(globalThis as any).__dicePassBudget.rollFrame(a,age);if(age<0)continue;','post-retime age');
    const pass='withRenderRegion(this.gl,this.renderRegion.get({...this.projection,pixelRatio:this.gl.getPixelRatio()}),()=>{this.gl.render(this.scene,this.camera);});';
    replace(pass,'(globalThis as any).__dicePassBudget.glPass(()=>{'+pass+'});','whole GL pass, including clear and region');
    replace("    this.emit('render-queued',", "    (globalThis as any).__dicePassBudget.prepared(this.active.at(-1));\n    this.emit('render-queued',",'prepared authoritative roll');
  } else if(file.endsWith('/extensions/workbench-dice3d/src/shared-overlay-canvas.ts')) {
    replace("layer={canvas,context:canvas.getContext('2d')!,refs:0};","layer={canvas,context:(globalThis as any).__dicePassBudget.wrap2D(canvas.getContext('2d')!,kind),refs:0};",'only shared 2D surfaces');
  } else if(file.endsWith('/extensions/workbench-dice3d/src/audio-mixer.ts')) {
    replace('t.at=at;t.engine.start(t.plan.impacts,loaded,at);', '(globalThis as any).__dicePassBudget?.audioStart(id,at,!!t.at);t.at=at;t.engine.start(t.plan.impacts,loaded,at);','actual audio schedule starts');
  } else if(file.endsWith('/extensions/workbench-dice3d/src/research/presentation.ts')) {
    replace('    super.draw(age,cue,appear);', '    super.draw(age,cue,appear);\n    const passCardWrites=(globalThis as any).__dicePassBudget.allowCardWrites(this.card);','detached-only update guard');
    const note="this.card.querySelector('.rule-note')!.textContent=visibleEvents.map(e=>e.label+(e.physicalNote?`（${e.physicalNote}）`:'')).join(' · ')||(landed?'真实落地 → 数字汇集 → 加值到账':'等待真实落地');";
    replace(note,'if(passCardWrites){'+note+'}','detached note write');
    replace("for(const d of this.row.dice){const chip=this.chips.get(d.id)!;", "for(const d of this.row.dice){if(passCardWrites){const chip=this.chips.get(d.id)!;",'detached chip updates');
    replace('if(d.raw!==d.value)chip.title=`实骰 ${d.raw} → 按规则 ${d.value}`;', 'if(d.raw!==d.value)chip.title=`实骰 ${d.raw} → 按规则 ${d.value}`;}','preserve actual research FX');
    replace("this.latest=total;this.total.textContent=String(total);this.total.animate([{transform:'scale(1.23)'},{transform:'scale(1)'}],{duration:280,easing:'ease-out'});", "this.latest=total;if(passCardWrites){this.total.textContent=String(total);this.total.animate([{transform:'scale(1.23)'},{transform:'scale(1)'}],{duration:280,easing:'ease-out'});}",'preserve latest bookkeeping');
    replace("this.finished=true;this.card.classList.add('complete');this.card.animate([{boxShadow:'inset 0 0 0 2px #6faf9180'},{boxShadow:'inset 0 0 0 2px #6faf9100'}],{duration:500});", "this.finished=true;if(passCardWrites){this.card.classList.add('complete');this.card.animate([{boxShadow:'inset 0 0 0 2px #6faf9180'},{boxShadow:'inset 0 0 0 2px #6faf9100'}],{duration:500});}",'preserve finished bookkeeping');
  }
  return code===source?null:code;
}
