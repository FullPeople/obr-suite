/** Arithmetic only: never execute JavaScript supplied by a sheet input. */
export function evaluateStatExpression(input:string,current:number):number|null {
  let text=String(input??'').trim().replaceAll('×','*').replaceAll('÷','/').replaceAll('−','-');
  if(!text||text.length>160||!Number.isFinite(current))return null;
  const absolute=text.startsWith('=');if(absolute)text=text.slice(1).trim();
  const relative=!absolute&&/^[+*/-]/.test(text);
  if(relative)text=`(${current})${text}`;
  const tokens=text.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+*/-]/g);
  if(!tokens||tokens.join('')!==text.replace(/\s/g,''))return null;
  let position=0,depth=0;
  const atom=():number=>{
    if(++depth>24)throw Error('depth');
    const token=tokens[position++];let value:number;
    if(token==='+'||token==='-')value=(token==='-'?-1:1)*atom();
    else if(token==='('){value=sum();if(tokens[position++]!==')')throw Error('parenthesis');}
    else {if(!token||!/^\d|^\./.test(token))throw Error('number');value=Number(token);}
    depth--;return value;
  };
  const product=():number=>{let value=atom();while(tokens[position]==='*'||tokens[position]==='/'){const op=tokens[position++],right=atom();if(op==='/'&&right===0)throw Error('zero');value=op==='*'?value*right:value/right;}return value;};
  const sum=():number=>{let value=product();while(tokens[position]==='+'||tokens[position]==='-'){const op=tokens[position++],right=product();value=op==='+'?value+right:value-right;}return value;};
  try{const value=sum();return position===tokens.length&&Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER?Math.floor(value):null;}catch{return null;}
}
