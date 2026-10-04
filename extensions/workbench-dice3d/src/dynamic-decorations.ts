import * as T from 'three';
import {outlineGeometry} from './outline-geometry';
import type {MaterialStyle} from './material-styles';
/** Thin, depth-tested contour treatments. No collision geometry or face normals are modified. */
export function addDynamicOutline(mesh:T.Mesh,geometry:T.BufferGeometry,style:MaterialStyle){
  if(!['comic','ink-flow','runic'].includes(style))return;
  const material=mesh.material as T.MeshPhysicalMaterial,time=material.userData.time;
  const code=style==='comic'?0:style==='ink-flow'?1:2;
  const shellMaterial=new T.ShaderMaterial({side:T.BackSide,depthWrite:false,
    uniforms:{time,pixelScale:{value:120},kind:{value:code}},
    vertexShader:`uniform float time;uniform float pixelScale;uniform float kind;
      void main(){float tick=floor(time*12.);
        float wobble=kind<.5?sin(dot(position,vec3(13,7,19))+tick*1.7)*.12:
          kind<1.5?sin(dot(position,vec3(12,17,9))+time*1.4)*.20:0.;
        float width=kind<.5?1.8:kind<1.5?1.0:1.2;
        vec3 p=position+normalize(position)*(width+wobble)/pixelScale;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
      }`,fragmentShader:'void main(){gl_FragColor=vec4(.012,.017,.024,1.);}'});
  const shell=new T.Mesh(geometry,shellMaterial);shell.userData.diceDecoration=true;mesh.add(shell);
  const edgeGeometry=outlineGeometry(geometry);
  // The complete real bevel edge is retained. A fragment pulse runs along it without replacing
  // it with particles or moving the rigid body's silhouette, including during physical hops.
  // Fade the emitted colour, not alpha. Overlapping edge fragments must not depend on
  // transparent-object insertion order when a roll is replayed or another player joins.
  const edgeMaterial=new T.ShaderMaterial({depthWrite:false,
    uniforms:{time,kind:{value:code},tint:{value:material.color.clone().convertLinearToSRGB().multiplyScalar(.65).addScalar(.35)}},
    vertexShader:`varying vec3 vLocal;void main(){vLocal=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position*1.002,1.);}`,
    fragmentShader:`uniform float time;uniform float kind;uniform vec3 tint;varying vec3 vLocal;
      void main(){
        if(kind>1.5){float phase=dot(vLocal,vec3(.65,.88,-.47))-time*.34;
          float pulse=pow(.5+.5*sin(phase*8.),8.);
          gl_FragColor=vec4(mix(tint*.16,tint,pulse),1.);
        }else{gl_FragColor=vec4(.012,.017,.024,1.);}
      }`});
  const edges=new T.LineSegments(edgeGeometry,edgeMaterial);edges.userData.diceDecoration=true;mesh.add(edges);
}
