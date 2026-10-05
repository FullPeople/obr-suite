import assert from 'node:assert/strict';
export function replaceExactly(code,needle,replacement,label=needle){assert.equal(code.split(needle).length-1,1,'exact probe boundary: '+label);return code.replace(needle,replacement);}
export function instrumentOutlineRenderer(code){
 const probe='(globalThis as any).__diceOutlineProbe';
 code=replaceExactly(code,'warm.push(m);this.diceSpace.add(m)',`${probe}.registerWarm(key,m);warm.push(m);this.diceSpace.add(m)`);
 const warm='await this.gl.compileAsync(this.scene,this.camera);this.gl.render(this.scene,this.camera);this.gl.getContext().finish();for(const m of warm){disposeDiceDecorations(m);this.diceSpace.remove(m)}';
 code=replaceExactly(code,warm,`${probe}.checkpoint('warm-before-compile',this);await this.gl.compileAsync(this.scene,this.camera);${probe}.checkpoint('warm-after-compile',this);this.gl.render(this.scene,this.camera);${probe}.checkpoint('warm-after-render',this);this.gl.getContext().finish();${probe}.checkpoint('warm-after-finish-before-dispose',this);for(const m of warm){disposeDiceDecorations(m);this.diceSpace.remove(m)}${probe}.checkpoint('warm-after-dispose',this);`);
 code=replaceExactly(code,"this.gl.domElement.style.opacity='1';",`this.gl.domElement.style.opacity='1';${probe}.checkpoint('renderer-ready',this);`);
 code=replaceExactly(code,'add(roll:Roll,start:number,presentation?:RollPresentation){',`add(roll:Roll,start:number,presentation?:RollPresentation){\n    ${probe}.startAdd(this,roll,start);`);
 code=replaceExactly(code,"this.emit('render-queued'",`${probe}.checkpoint('add-prepared',this);this.emit('render-queued'`);
 const render='withRenderRegion(this.gl,this.renderRegion.get({...this.projection,pixelRatio:this.gl.getPixelRatio()}),()=>{this.gl.render(this.scene,this.camera);});';
 code=replaceExactly(code,render,render+`${probe}.afterFrame(this);`);
 code=replaceExactly(code,"this.emit('render-complete',{roll:a.roll.request.id})",`${probe}.checkpoint('roll-complete',this);this.emit('render-complete',{roll:a.roll.request.id})`);
 return code;
}
export function outlineProgramPlugin(){return {name:'dice-outline-program-observer',enforce:'pre',transform(code,id){if(id.replaceAll('\\','/').endsWith('/extensions/workbench-dice3d/src/renderer.ts'))return instrumentOutlineRenderer(code);}};}
