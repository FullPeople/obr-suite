import type {Mesh,MeshPhysicalMaterial} from 'three';
import type {ClampEpisode} from './rule-timeline';
/** Highlight only. No texture, glyph UV, geometry, shader or physical pose may be replaced. */
export class RuleFaceHighlight{
  private materials:MeshPhysicalMaterial[]=[];
  constructor(private ids:string[],private episodes:ClampEpisode[]){}
  prepare(meshes:Mesh[]){this.materials=meshes.map(m=>m.material as MeshPhysicalMaterial);}
  draw(age:number){
    for(const e of this.episodes)if(age>=e.land&&age<e.land+.22){
      const mat=this.materials[this.ids.indexOf(e.id)];if(mat?.userData.glyphWipe)mat.userData.glyphWipe.value=(age-e.land)/.22;
    }
  }
  dispose(){this.materials=[];}
}
