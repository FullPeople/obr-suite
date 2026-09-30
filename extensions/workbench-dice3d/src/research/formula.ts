/** LOCAL research only. A rule consumes physical outcomes; it never invents a replacement roll. */
import type {Kind} from '../types';
export type Node={type:'number';value:number}|{type:'dice';count:number;kind:Kind}|{type:'binary';op:'+'|'-'|'*';left:Node;right:Node}|{type:'call';name:string;args:Node[]};
export interface ResearchDie{id:string;kind:Kind;raw:number;value:number;sign:number;kept:boolean;flags:string[];parent?:string}
export interface RuleEvent{kind:string;dice:string[];label:string;from?:number;to?:number;physicalNote?:string}
export interface Evaluation{dice:ResearchDie[];events:RuleEvent[];compute:()=>number;operation:string}
export interface FormulaRow extends Evaluation{formula:string;index:number;total:number}
export interface CastSpec{kind:Kind;count:number;reason:string}
/** Every group in one call is ready on the same causal frontier and must share one simulation. */
export type PhysicalRoller=(groups:CastSpec[])=>Promise<{id:string;value:number}[][]>;
type Task<T>=Generator<CastSpec[],T,ResearchDie[][]>;
/** Pull all independent branches to their next physical dependency, without timer batching. */
function* together<T>(tasks:Task<T>[]):Task<T[]>{
  let states=tasks.map(task=>task.next());
  while(states.some(state=>!state.done)){
    const groups=states.flatMap(state=>state.done?[]:state.value),answers:ResearchDie[][]=yield groups;
    let offset=0;
    states=states.map((state,i)=>{if(state.done)return state;const count=state.value.length;
      const slice=answers.slice(offset,offset+count);offset+=count;return tasks[i].next(slice);});
  }
  return states.map(state=>{if(!state.done)throw Error('公式依赖尚未完成');return state.value;});
}
const FUNCTIONS=['adv','dis','max','min','reset','resetmin','resetmax','repeat','same','burst'];
const SIDES=[4,6,8,10,12,20,100];
export const normalizeFormula=(text:string)=>text.replaceAll('（','(').replaceAll('）',')').replaceAll('，',',').replaceAll('×','*').replaceAll('−','-').replace(/\s+/g,'').toLowerCase();
export function parseFormula(text:string):Node{
  const input=normalizeFormula(text);if(!input||input.length>240)throw Error('公式须为 1–240 个字符');
  let pos=0,nodes=0;
  const error=()=>Error(`公式第 ${pos+1} 位无法识别；支持 NdM、+ − × 和规则函数`);
  const primary=(depth:number):Node=>{
    if(depth>10||++nodes>120)throw Error('公式嵌套或长度超出本地实验上限');
    if(input[pos]==='+'||input[pos]==='-'){const op=input[pos++];const right=primary(depth+1);return op==='+'?right:{type:'binary',op:'-',left:{type:'number',value:0},right}}
    if(input[pos]==='('){pos++;const node=sum(depth+1);if(input[pos++]!==')')throw error();return node}
    const tail=input.slice(pos),dice=/^(\d*)d(\d+)/.exec(tail);
    if(dice){pos+=dice[0].length;const count=Number(dice[1]||1),sides=Number(dice[2]);
      if(!Number.isInteger(count)||count<1||count>100||!SIDES.includes(sides))throw Error('支持 1–100 枚 d4/d6/d8/d10/d12/d20/d100；其他面数没有对应实体模型');
      return{type:'dice',count,kind:`d${sides}` as Kind};}
    const number=/^\d+/.exec(tail);if(number){pos+=number[0].length;const value=Number(number[0]);if(value>999999)throw Error('数值超过 999999');return{type:'number',value}}
    const fn=/^([a-z]+)\(/.exec(tail);if(fn){if(!FUNCTIONS.includes(fn[1]))throw Error('未知函数 '+fn[1]);pos+=fn[0].length;
      const args:Node[]=[];if(input[pos]!==')'){args.push(sum(depth+1));while(input[pos]===','){pos++;args.push(sum(depth+1))}}
      if(input[pos++]!==')')throw error();return{type:'call',name:fn[1],args};}
    throw error();
  };
  const product=(depth:number):Node=>{let node=primary(depth);while(input[pos]==='*'){pos++;node={type:'binary',op:'*',left:node,right:primary(depth+1)}}return node};
  const sum=(depth:number):Node=>{let node=product(depth);while(input[pos]==='+'||input[pos]==='-'){const op=input[pos++] as '+'|'-';node={type:'binary',op,left:node,right:product(depth+1)}}return node};
  const ast=sum(0);if(pos!==input.length)throw error();validate(ast,true);return ast;
}
const constant=(node:Node):number=>{if(node.type==='number')return node.value;if(node.type==='binary'){const a=constant(node.left),b=constant(node.right);return node.op==='+'?a+b:node.op==='-'?a-b:a*b}throw Error('函数参数必须是整数，不接受骰子作为阈值')};
/** Reserve the independent first frontier, not 100 phantom dice per tiny submission. */
export function initialPhysicalCount(node:Node):number{
 if(node.type==='number')return 0;
 if(node.type==='dice')return node.count*((node.kind as string)==='d100'?2:1);
 if(node.type==='binary')return initialPhysicalCount(node.left)+initialPhysicalCount(node.right);
 if(node.name==='repeat')return constant(node.args[0])*initialPhysicalCount(node.args[1]);
 if(node.name==='adv'||node.name==='dis')return (1+(node.args[1]?constant(node.args[1]):1))*initialPhysicalCount(node.args[0]);
 return initialPhysicalCount(node.args[0]);
}
function validate(node:Node,root=false):void{
  if(node.type==='binary'){validate(node.left);validate(node.right);return}
  if(node.type!=='call')return;
  const {name,args}=node,min=['max','min','reset','resetmin','resetmax','repeat'].includes(name)?2:1,max=['adv','dis'].includes(name)?2:min;
  if(args.length<min||args.length>max)throw Error(`${name} 的参数数量不正确`);
  if(name==='repeat'){if(!root)throw Error('repeat 只允许放在最外层，每次结果独立显示');const n=constant(args[0]);if(!Number.isInteger(n)||n<1||n>5)throw Error('repeat 本地上限为 5 次');validate(args[1]);return;}
  validate(args[0]);if(args[1]){const n=constant(args[1]);if(!Number.isInteger(n)||Math.abs(n)>999999)throw Error('阈值必须是有界整数');if((name==='adv'||name==='dis')&&(n<1||n>3))throw Error('adv/dis 额外次数为 1–3');}
}
export const formatNode=(n:Node):string=>n.type==='number'?String(n.value):n.type==='dice'?`${n.count}${n.kind}`:n.type==='call'?`${n.name}(${n.args.map(formatNode).join(',')})`:`(${formatNode(n.left)}${n.op}${formatNode(n.right)})`;
const ensureTotal=(n:number)=>{if(!Number.isSafeInteger(n)||Math.abs(n)>1e9)throw Error('公式结果超过单机实验 ±10 亿的安全整数上限');return n};
const containsDice=(n:Node):boolean=>n.type==='dice'||(n.type==='binary'&&(containsDice(n.left)||containsDice(n.right)))||(n.type==='call'&&n.args.some(containsDice));
const containsMultiply=(n:Node):boolean=>n.type==='binary'&&(n.op==='*'||containsMultiply(n.left)||containsMultiply(n.right))||n.type==='call'&&n.args.some(containsMultiply);
/** A multiplication of one subpool must never be labelled as multiplying the whole pool. */
export function operationLabel(node:Node):string{
  if(!containsMultiply(node))return '';
  const steps=(n:Node):string[]|null=>{
    if(n.type!=='binary')return containsMultiply(n)?null:[];
    if(!containsDice(n.right)){const prior=steps(n.left);return prior&&[...prior,`${n.op==='*'?'×':n.op}${constant(n.right)}`];}
    if(!containsDice(n.left)&&n.op==='*'){const prior=steps(n.right);return prior&&[...prior,`×${constant(n.left)}`];}
    return containsMultiply(n)?null:[];
  };
  return steps(node)?.join(' → ')||'依公式计算';
}
/** The 2D reference has an obsolete reset=assign comment. Actual code and this engine reroll once. */
export async function evaluateFormula(ast:Node,roll:PhysicalRoller):Promise<FormulaRow[]>{
  let physicalCount=0;
  function* cast(kind:Kind,count:number,reason:string):Task<ResearchDie[]>{
    const answers:ResearchDie[][]=yield [{kind,count,reason}];return answers[0];
  };
  function* evaluate(node:Node,reason='普通'):Task<Evaluation>{
    if(node.type==='number')return{dice:[],events:[],compute:()=>node.value,operation:''};
    if(node.type==='dice'){const dice=yield* cast(node.kind,node.count,reason),leaves=[...dice];return{dice,events:[],compute:()=>leaves.reduce((n,d)=>n+d.value,0),operation:''};}
    if(node.type==='binary'){
      const [a,b]=yield* together([evaluate(node.left,reason),evaluate(node.right,reason)]);
      if(node.op==='-')for(const d of b.dice)d.sign*=-1;
      const compute=()=>ensureTotal(node.op==='+'?a.compute()+b.compute():node.op==='-'?a.compute()-b.compute():a.compute()*b.compute());
      const operation=node.op==='*'&&b.dice.length===0?`×${b.compute()}`:node.op==='*'&&a.dice.length===0?`×${a.compute()}`:a.operation||b.operation;
      return{dice:[...a.dice,...b.dice],events:[...a.events,...b.events],compute,operation};
    }
    const {name,args}=node;
    if(name==='adv'||name==='dis'){
      const sets=yield* together(Array.from({length:(args[1]?constant(args[1]):1)+1},()=>evaluate(args[0],name==='adv'?'优势候选':'劣势候选')));
      let winner=0;for(let i=1;i<sets.length;i++)if(name==='adv'?sets[i].compute()>sets[winner].compute():sets[i].compute()<sets[winner].compute())winner=i;
      sets.forEach((set,i)=>{for(const d of set.dice){if(i!==winner){d.kept=false;d.flags.push('舍弃')}else if(d.kept)d.flags.push(name==='adv'?'取高':'取低')}});
      return{dice:sets.flatMap(s=>s.dice),events:[...sets.flatMap(s=>s.events),{kind:name,dice:sets[winner].dice.filter(d=>d.kept).map(d=>d.id),label:name==='adv'?(sets.length===3?'精灵之准 · 三选一':'优势 · 取高'):'劣势 · 取低'}],compute:sets[winner].compute,operation:sets[winner].operation};
    }
    const inner=yield* evaluate(args[0],reason),kept=inner.dice.filter(d=>d.kept);
    if(name==='same'){
      const byValue=new Map<number,ResearchDie[]>();for(const d of kept)byValue.set(d.value,[...(byValue.get(d.value)||[]),d]);
      for(const group of byValue.values())if(group.length>1){for(const d of group)d.flags.push('同值');inner.events.push({kind:'same',dice:group.map(d=>d.id),label:`${group.length} 枚同值 ${group[0].value}`});}
      return inner;
    }
    if(name==='max'||name==='min'){
      const threshold=constant(args[1]);for(const d of kept){const value=name==='max'?Math.max(d.value,threshold):Math.min(d.value,threshold);
        if(value!==d.value){const from=d.value;d.value=value;d.flags.push(name==='max'?'保底':'封顶');inner.events.push({kind:name,dice:[d.id],from,to:value,label:`${name==='max'?'保底':'封顶'} ${from} → ${value}`});}}
      return inner;
    }
    if(name==='reset'||name==='resetmin'||name==='resetmax'){
      const threshold=constant(args[1]),selected=kept.filter(d=>name==='reset'?d.value===threshold:name==='resetmin'?d.value<=threshold:d.value>=threshold);
      const replacements=yield* together(selected.map(d=>cast(d.kind,1,'重投一次')));
      for(const [i,d] of selected.entries()){
        const next=replacements[i][0];next.parent=d.id;next.sign=d.sign;next.flags.push('重投');
        // The expression's leaf now points to the real replacement. Keep the old raw die as a
        // separate discarded record for animation/history; never change its physical trajectory.
        const old={...d,flags:[...d.flags,'重投舍弃'],kept:false};inner.dice.splice(inner.dice.indexOf(d),0,old);
        Object.assign(d,next);inner.events.push({kind:'reroll',dice:[old.id,d.id],label:`重投一次 ${old.raw} → ${d.raw}`});
      }
      return inner;
    }
    if(name==='burst'){
      const children:ResearchDie[]=[],weighted:{die:ResearchDie;sign:number}[]=[];
      let frontier=kept.filter(d=>d.value===Number(d.kind.slice(1)));
      for(let depth=0;frontier.length;depth++){
        if(depth>=5)throw Error('爆炸骰连锁达到 5 次实验上限：停止并明确报错，不把截断值冒充最终结果');
        const additions=yield* together(frontier.map(parent=>cast(parent.kind,1,'满值追加'))),following:ResearchDie[]=[];
        for(const [i,parent] of frontier.entries()){
          const next=additions[i][0];next.parent=parent.id;next.sign=parent.sign;next.flags.push('追加');parent.flags.push('触发追加');
          children.push(next);weighted.push({die:next,sign:parent.sign});inner.events.push({kind:'burst',dice:[parent.id,next.id],label:`满值 ${parent.value} · 追加一枚`});
          if(next.value===Number(next.kind.slice(1)))following.push(next);
        }
        frontier=following;
      }
      return{dice:[...inner.dice,...children],events:inner.events,operation:inner.operation,compute:()=>inner.compute()+weighted.reduce((n,x)=>n+x.die.value*x.sign,0)};
    }
    throw Error('本地实验尚不支持这个嵌套规则: '+name);
  };
  const count=ast.type==='call'&&ast.name==='repeat'?constant(ast.args[0]):1,inner=ast.type==='call'&&ast.name==='repeat'?ast.args[1]:ast;
  const task=together(Array.from({length:count},()=>evaluate(inner))),ids=new Set<string>();let step=task.next();
  while(!step.done){
    const groups=step.value;physicalCount+=groups.reduce((n,g)=>n+g.count,0);
    if(physicalCount>100)throw Error('单个公式超过 100 枚骰子的预算（包含追加和重投）');
    const answers=await roll(groups);
    if(answers.length!==groups.length)throw Error('物理返回的骰池分组不匹配');
    const dice=answers.map((out,i)=>{const {kind,count}=groups[i];
      if(out.length!==count||out.some(d=>!Number.isInteger(d.value)||d.value<1||d.value>Number(kind.slice(1))))throw Error('物理返回不合法面值');
      return out.map(d=>{if(!d.id||ids.has(d.id))throw Error('物理返回重复或缺失骰子身份');ids.add(d.id);return{...d,kind,raw:d.value,sign:1,kept:true,flags:[]};});
    });
    step=task.next(dice);
  }
  return step.value.map((result,index)=>{if(!result.dice.length)throw Error('请输入至少一颗骰子');return{...result,operation:operationLabel(inner),formula:formatNode(inner),index,total:ensureTotal(result.compute())};});
}
