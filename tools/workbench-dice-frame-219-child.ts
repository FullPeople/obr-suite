import {submitCompat3d,submitDice3d} from '../src/workbench/dice-submit';
import './workbench-dice-frame-219-sdk';
const own:any={last:undefined,error:'',results:[]};(window as any).frameProbe=own;
own.roll=async(hidden=false,advantage=false)=>{const rollId='init-'+crypto.randomUUID();own.error='';own.last=rollId;try{const result=await submitCompat3d({itemId:'synthetic-token',rollId,modifier:3,label:'先攻',hidden,winnerIdx:0,dice:advantage?[{type:'d20',value:17},{type:'d20',value:5,loser:true}]:[{type:'d20',value:17}]});own.results.push(result);document.getElementById('result')!.textContent='先攻 20';return result;}catch(error){own.error=String(error);throw error;}};
document.body.innerHTML='<button id="roll">投掷先攻</button><span id="result"></span>';document.getElementById('roll')!.onclick=()=>void own.roll();
