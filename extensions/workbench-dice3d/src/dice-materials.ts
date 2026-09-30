import * as T from 'three';
import type {Theme} from './types';
import {STYLE_SETTINGS,lettering,bodyRGB} from './material-styles';
import {DYNAMIC_HELPERS,DYNAMIC_BODY,DYNAMIC_LIGHT,DYNAMIC_INK} from './dynamic-materials';

/** Cartoon keeps unlit outlined ink; other styles use subtly lit inlay protected from glare. */
export function createDiceMaterial(theme:Theme,mask:T.Texture):T.MeshPhysicalMaterial{
  if(!theme.style)throw Error('缺少明确的材质风格: '+theme.id);
  const settings=STYLE_SETTINGS[theme.style],{code,...properties}=settings;
  const mat=new T.MeshPhysicalMaterial({...properties,color:new T.Color(...theme.color as [number,number,number]).convertSRGBToLinear(),
    transparent:theme.style==='resin',depthWrite:theme.style!=='resin',side:T.FrontSide,ior:1.45});
  const ink=lettering(theme.color,theme.style),image=mask.image as {width:number;height:number};
  mat.userData={glyphColor:{value:new T.Color(...ink.glyph)},glyphOutline:{value:new T.Color(...ink.outline)},glyphWipe:{value:-1},time:{value:0},playerTint:{value:0}};
  mat.onBeforeCompile=function(shader:any){
    Object.assign(shader.uniforms,{diceMask:{value:mask},diceTexel:{value:new T.Vector2(1/image.width,1/image.height)},diceStyle:{value:code},
      diceGlyph:this.userData.glyphColor,diceOutline:this.userData.glyphOutline,diceWipe:this.userData.glyphWipe,diceTime:this.userData.time});
    shader.vertexShader='attribute vec2 diceGlyph; varying vec2 vDiceGlyph; varying vec3 vDiceLocal; varying vec3 vDiceViewLocal;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvDiceGlyph=diceGlyph; vDiceLocal=position; vDiceViewLocal=inverseTransformDirection(vec3(0.,0.,1.),modelViewMatrix);');
    shader.fragmentShader=`uniform sampler2D diceMask; uniform vec2 diceTexel; uniform vec3 diceGlyph; uniform vec3 diceOutline; uniform float diceStyle; uniform float diceWipe; uniform float diceTime;
      varying vec2 vDiceGlyph; varying vec3 vDiceLocal; varying vec3 vDiceViewLocal;
      float diceNoise(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
      float diceCloud(vec3 p){return .5+.24*sin(p.x*4.+sin(p.z*3.))+.18*sin(p.y*7.+p.z*5.+sin(p.x*4.));}
      ${DYNAMIC_HELPERS}
      `+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec3 dp=vDiceLocal;
      float grain=diceNoise(floor(dp*180.));
      float weave=.5+.5*sin(dp.y*110.+sin(dp.x*9.+dp.z*5.)*.65);
      float cloud=clamp(diceCloud(dp),0.,1.);
      float dynamicGlow=0.;vec3 dynamicTint=vec3(0.);
      if(diceStyle<.5) diffuseColor.rgb*=.94+.06*grain;
      else if(diceStyle<1.5) diffuseColor.rgb*=.84+.16*weave;
      else if(diceStyle<2.5) diffuseColor.rgb=(diffuseColor.rgb*.76+vec3(.012))*(.60+.18*cloud+.10*weave);
      else if(diceStyle<3.5) diffuseColor.rgb=mix(diffuseColor.rgb*.66,diffuseColor.rgb*.94+vec3(.018),cloud);
      else if(diceStyle<4.5){
        float tick=floor(diceTime*8.);
        vec3 warp=dp+vec3(sin(dp.y*11.+tick*1.7),sin(dp.z*9.+tick*2.3),sin(dp.x*13.+tick))*.018;
        float hatch=1.-smoothstep(.06,.13,abs(sin((warp.x+warp.y*.72+warp.z*.33)*25.)));
        float scribble=1.-smoothstep(.045,.10,abs(sin(warp.x*8.+sin(warp.z*12.+warp.y*7.))));
        vec3 paper=max(diffuseColor.rgb,vec3(.024));
        diffuseColor.rgb=mix(paper,vec3(.004),max(hatch*.25,scribble*.50));
      }
      ${DYNAMIC_BODY}
      float ink=smoothstep(.36,.64,texture2D(diceMask,vDiceGlyph).r);
      vec2 px=clamp(fwidth(vDiceGlyph)*1.05,diceTexel*1.4,vec2(.009));
      float around=max(max(texture2D(diceMask,vDiceGlyph+vec2(px.x,0.)).r,texture2D(diceMask,vDiceGlyph-vec2(px.x,0.)).r),
        max(texture2D(diceMask,vDiceGlyph+vec2(0.,px.y)).r,texture2D(diceMask,vDiceGlyph-vec2(0.,px.y)).r));
      float halo=max(ink,smoothstep(.20,.60,around));
      // Printed inlay participates in the actual material before the protected final ink pass.
      // Pure cartoon deliberately retains its existing flat, bold lettering unchanged.
      vec3 inkLinear=mix(diceGlyph/12.92,pow((diceGlyph+vec3(.055))/1.055,vec3(2.4)),step(vec3(.04045),diceGlyph));
      if(diceStyle<3.5)diffuseColor.rgb=mix(diffuseColor.rgb,inkLinear,ink);
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      if(diceStyle>.5&&diceStyle<1.5)roughnessFactor=clamp(roughnessFactor+(weave-.5)*.09,.27,.46);
      float inkRoughness=diceStyle<.5?.62:diceStyle<1.5?.40:diceStyle<2.5?.38:.56;
      roughnessFactor=mix(roughnessFactor,diceStyle>3.5?1.:inkRoughness,ink);
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <metalnessmap_fragment>',`#include <metalnessmap_fragment>
      if(diceStyle<3.5)metalnessFactor=mix(metalnessFactor,diceStyle>.5&&diceStyle<2.5?.55:0.,ink);
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
      if(diceStyle>1.5&&diceStyle<2.5){
        float shift=dot(normalize(vDiceViewLocal),vec3(.35,.16,.27));
        float eye=pow(max(0.,1.-abs(dp.y+dp.x*.17+shift)*3.6),5.);
        outgoingLight+=(diffuseColor.rgb*.55+vec3(.045))*(eye*.85+weave*.025)*(1.-ink);
      }
      if(diceStyle>2.5&&diceStyle<3.5){
        float edge=pow(1.-abs(dot(normal,normalize(vViewPosition))),2.);
        diffuseColor.a=clamp(.43+edge*.32+cloud*.12,.43,.86);
        outgoingLight+=diffuseColor.rgb*edge*.18;
      }
      if(diceStyle>3.5&&diceStyle<4.5){
        float shade=dot(normal,normalize(vec3(-.35,.8,.5)));
        float bands=shade>.45?1.15:shade>-.2?.80:.46;
        outgoingLight=diffuseColor.rgb*bands+vec3(.012);
      }
      ${DYNAMIC_LIGHT}
      // Gently limit extreme glints while retaining differences between the material profiles.
      outgoingLight=outgoingLight/(vec3(1.)+outgoingLight*.14);
      #include <opaque_fragment>
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <colorspace_fragment>',`#include <colorspace_fragment>
      float wipe=diceWipe>=0.?1.-smoothstep(.02,.11,abs(dot(vDiceGlyph,vec2(.72,.28))-diceWipe)):0.;
      if(diceStyle>3.5&&diceStyle<5.5){
        // Accepted cartoon treatment: do not change its black/white keyline or brightness.
        vec3 marked=mix(diceGlyph,mix(diceGlyph,vec3(.60,.52,.25),.35),wipe);
        gl_FragColor.rgb=mix(gl_FragColor.rgb,diceOutline,halo);
        gl_FragColor.rgb=mix(gl_FragColor.rgb,marked,ink);
        gl_FragColor.a=mix(gl_FragColor.a,1.,halo);
      }${DYNAMIC_INK}else{
        // Restrained pigment, no black/white silhouette. Actual BRDF adds only bounded shading,
        // so a grazing reflection cannot erase an engraved digit again.
        float metalInk=diceStyle>.5&&diceStyle<2.5?1.:0.;
        vec3 shaded=clamp(gl_FragColor.rgb,diceGlyph-vec3(.10),diceGlyph+vec3(.08));
        vec3 marked=mix(diceGlyph,shaded,mix(.22,.45,metalInk));
        // Subpixel recessed lip: two opposite slopes, not a continuous outline around the text.
        vec2 lip=diceTexel*.7;
        float bevel=texture2D(diceMask,vDiceGlyph+lip).r-texture2D(diceMask,vDiceGlyph-lip).r;
        gl_FragColor.rgb*=1.-max(0.,bevel)*.12*(1.-ink);
        gl_FragColor.rgb+=max(0.,-bevel)*.025*(1.-ink);
        marked=mix(marked,marked*.86+vec3(.08),wipe*.7);
        gl_FragColor.rgb=mix(gl_FragColor.rgb,marked,ink);
        gl_FragColor.a=mix(gl_FragColor.a,1.,ink);
      }
    `);
  };
  mat.customProgramCacheKey=()=>`dice-inlay-v3-${theme.style}`;
  return mat;
}

export function instanceDiceMaterial(base:T.MeshPhysicalMaterial,theme:Theme,color?:string){
  const mat=base.clone(),ink=lettering(bodyRGB(theme,color),theme.style);
  mat.onBeforeCompile=base.onBeforeCompile;mat.customProgramCacheKey=base.customProgramCacheKey;
  mat.userData={glyphColor:{value:new T.Color(...ink.glyph)},glyphOutline:{value:new T.Color(...ink.outline)},glyphWipe:{value:-1},time:{value:0},playerTint:{value:color?1:0}};
  if(color)mat.color.set(color);return mat;
}

/** Only the drawn ink moves. The real mesh, face labels and authoritative rigid body stay put. */
export function addSketchOutline(mesh:T.Mesh,geometry:T.BufferGeometry){
  const time=(mesh.material as T.Material).userData.time;
  const outline=new T.ShaderMaterial({side:T.BackSide,depthWrite:false,uniforms:{time,pixelScale:{value:120}},
    vertexShader:`uniform float time; uniform float pixelScale; void main(){
      float tick=floor(time*8.);float wobble=sin(dot(position,vec3(8.,13.,17.))+tick*1.7);
      vec3 p=position+normalize(position)*(1.8+.45*wobble)/pixelScale;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
    }`,fragmentShader:'void main(){gl_FragColor=vec4(.018,.023,.035,1.);}'});
  const shell=new T.Mesh(geometry,outline);shell.userData.diceDecoration=true;mesh.add(shell);
  const edges=new T.EdgesGeometry(geometry,24),array=edges.getAttribute('position'),points:number[]=[];
  for(let i=0;i<array.count;i+=2)for(let k=0;k<6;k++)for(const t of [k/6,(k+1)/6])for(let axis=0;axis<3;axis++)points.push(array.getComponent(i,axis)*(1-t)+array.getComponent(i+1,axis)*t);
  edges.dispose();const lineGeo=new T.BufferGeometry();lineGeo.setAttribute('position',new T.Float32BufferAttribute(points,3));
  const ink=new T.ShaderMaterial({depthWrite:false,uniforms:{time},
    vertexShader:`uniform float time; void main(){float tick=floor(time*8.);vec3 p=position*1.002;
      p+=vec3(sin(p.y*23.+tick),sin(p.z*21.+tick*1.3),sin(p.x*19.+tick*.7))*.003;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
    fragmentShader:'void main(){gl_FragColor=vec4(.018,.023,.035,1.);}'});
  const lines=new T.LineSegments(lineGeo,ink);lines.userData.diceDecoration=true;lines.userData.ownsGeometry=true;mesh.add(lines);
}
export function disposeDiceDecorations(mesh:T.Mesh){for(const child of [...mesh.children])if(child.userData.diceDecoration){
  const drawable=child as T.Mesh;(drawable.material as T.Material).dispose();if(child.userData.ownsGeometry)drawable.geometry.dispose();mesh.remove(child);
}}
