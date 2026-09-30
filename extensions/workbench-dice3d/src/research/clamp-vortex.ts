import * as T from 'three';
import type {ClampEpisode,ClampKind} from './rule-timeline';
export const vortexRadius=(kind:ClampKind,progress:number)=>kind==='max'?.70+progress*.90:1.60-progress*.90;
const SEGMENTS=64,ARMS=3,SIDES=10;
/** Thick continuous, lit 3D bands anchored to the floor below the die, never its mid-air waist. */
export class ClampVortices{
  private entries:{episode:ClampEpisode;dieIndex:number;group:T.Group;geo:T.BufferGeometry;material:T.MeshStandardMaterial}[]=[];
  private depthMasks:T.Mesh[]=[];
  private depthMaterial=new T.MeshBasicMaterial({colorWrite:false,depthWrite:true,depthTest:true});
  private tangent=new T.Vector3();private radial=new T.Vector3();private side=new T.Vector3();private vertical=new T.Vector3();private normal=new T.Vector3();
  constructor(ids:string[],episodes:ClampEpisode[]){
    for(const episode of episodes){
      const geo=new T.BufferGeometry(),count=ARMS*(SEGMENTS+1)*(SIDES+1),indices:number[]=[];
      for(let arm=0;arm<ARMS;arm++)for(let s=0;s<SEGMENTS;s++)for(let j=0;j<SIDES;j++){
        const a=(arm*(SEGMENTS+1)+s)*(SIDES+1)+j,b=a+SIDES+1;indices.push(a,b,a+1,a+1,b,b+1);
      }
      geo.setAttribute('position',new T.BufferAttribute(new Float32Array(count*3),3).setUsage(T.DynamicDrawUsage));
      geo.setAttribute('normal',new T.BufferAttribute(new Float32Array(count*3),3).setUsage(T.DynamicDrawUsage));geo.setIndex(indices);
      const color=new T.Color(episode.kind==='max'?'#55c2ac':'#aa80d7');
      const material=new T.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.19,roughness:.52,metalness:.12,
        transparent:true,opacity:0,depthTest:true,depthWrite:false,side:T.DoubleSide,blending:T.NormalBlending});
      const ribbon=new T.Mesh(geo,material);ribbon.frustumCulled=false;ribbon.renderOrder=3;
      const group=new T.Group();group.name='rule-vortex';group.visible=false;group.add(ribbon);
      this.entries.push({episode,dieIndex:ids.indexOf(episode.id),group,geo,material});
    }
  }
  draw(age:number,meshes:T.Mesh[]){
    const active=this.entries.some(e=>age>=e.episode.start&&age<e.episode.end);
    // Resin does not write depth normally. A colourless hull while the effect is active gives the
    // vortex hard occlusion on all five styles without making the resin colour opaque.
    if(this.entries.length&&!this.depthMasks.length)for(const mesh of meshes){
      const mask=new T.Mesh(mesh.geometry,this.depthMaterial);mask.name='rule-vortex-depth';mask.renderOrder=-10;mask.visible=false;mesh.add(mask);this.depthMasks.push(mask);
    }
    for(const mask of this.depthMasks)mask.visible=active;
    const {tangent,radial,side,vertical,normal}=this;
    for(const e of this.entries){
      const mesh=meshes[e.dieIndex];if(!mesh)continue;
      if(!e.group.parent)mesh.parent!.add(e.group);
      const c=e.episode,span=c.end-c.start,u=Math.max(0,Math.min(1,(age-c.start)/span));
      e.group.visible=mesh.visible&&age>=c.start&&age<c.end;if(!e.group.visible)continue;
      // Physics floor is y=0 in this shared space. Stay beneath the committed landing XZ while
      // the body hops above it; its shadow and depth silhouette cover the centre of the vortex.
      e.group.position.set(c.floor[0],.012,c.floor[1]);
      const radius=mesh.geometry.boundingSphere!.radius,scale=vortexRadius(c.kind,u),direction=c.kind==='max'?1:-1;
      const fade=Math.min(1,(age-c.start)/.13)*Math.min(1,(c.end-age)/.24);e.material.opacity=fade*.94;
      const vertices=e.geo.getAttribute('position') as T.BufferAttribute,normals=e.geo.getAttribute('normal') as T.BufferAttribute;
      for(let arm=0;arm<ARMS;arm++)for(let s=0;s<=SEGMENTS;s++){
        const t=s/SEGMENTS,angle=arm*Math.PI*2/ARMS+t*Math.PI*1.60+age*direction*4.8;
        const r=radius*(.38+scale*.82*t),y=radius*(.048+t*.045),dr=radius*scale*.82,da=Math.PI*1.60;
        const co=Math.cos(angle),si=Math.sin(angle),taper=.03+.97*Math.pow(Math.sin(t*Math.PI),.55);
        const width=radius*.30*taper,thickness=radius*.038*taper;
        tangent.set(dr*co-r*si*da,radius*.045,dr*si+r*co*da).normalize();radial.set(co,0,si);
        side.copy(radial).addScaledVector(tangent,-radial.dot(tangent)).normalize();vertical.crossVectors(tangent,side).normalize();
        for(let j=0;j<=SIDES;j++){
          const a=j/SIDES*Math.PI*2,x=Math.cos(a),z=Math.sin(a),i=(arm*(SEGMENTS+1)+s)*(SIDES+1)+j;
          vertices.setXYZ(i,co*r+side.x*width*x+vertical.x*thickness*z,y+side.y*width*x+vertical.y*thickness*z,si*r+side.z*width*x+vertical.z*thickness*z);
          normal.copy(side).multiplyScalar(x/width).addScaledVector(vertical,z/thickness).normalize();normals.setXYZ(i,normal.x,normal.y,normal.z);
        }
      }
      vertices.needsUpdate=true;normals.needsUpdate=true;
    }
  }
  dispose(){for(const e of this.entries){e.group.removeFromParent();e.geo.dispose();e.material.dispose();}for(const m of this.depthMasks)m.removeFromParent();this.depthMaterial.dispose();this.entries=[];this.depthMasks=[];}
}
