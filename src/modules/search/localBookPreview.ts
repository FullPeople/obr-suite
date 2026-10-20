type Row=Record<string,any>;
type Helpers={escape:(text:string)=>string;rich:(text:string)=>string;tr:(zh:string,en:string)=>string;monster?:(data:Row)=>string;metadata?:(data:Row)=>string};
function imageUrl(value:unknown):string|undefined{
 if(typeof value!=='string')return;
 try{const url=new URL(value);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password)return url.href;}catch{}
}

/** A complete reading view of the saved body. Unsupported structures retain
 * their original fields visibly; source data never becomes executable HTML. */
export function renderLocalBook(data:Row,{escape:esc,rich,tr,monster,metadata}:Helpers):string{
 const book=data._localBook,chapters:unknown[]=Array.isArray(book?.data)?book.data:[];
 const json=(value:unknown)=>{try{return esc(JSON.stringify(value,null,2));}catch{return esc(tr('结构过深，请导出原文件核对。','The structure is too deep; export the original file for review.'));}};
 const fallback=(value:Row,label=tr('未支持结构，待核对','Unsupported structure; review required'))=>`<details open class="local-book-notice"><summary>${esc(label)}</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${json(value)}</pre></details>`;
 const render=(value:unknown,depth=0,inline=false):string=>{
  if(value==null)return '';
  if(typeof value==='string')return inline?rich(value):`<p>${rich(value)}</p>`;
  if(typeof value==='number'||typeof value==='boolean')return esc(String(value));
  if(Array.isArray(value))return value.map(item=>render(item,depth+1,inline)).join('');
  if(typeof value!=='object')return '';
  const row=value as Row;if(depth>64)return fallback(row);
  const title=typeof row.name==='string'?row.name:typeof row.ENG_name==='string'?row.ENG_name:'';
  const heading=title?`<h4>${rich(title)}</h4>`:'';
  const type=row.type||'entries';
  if(type==='entries'||type==='section')return row.entries!==undefined||row.entry!==undefined?heading+render(row.entries??row.entry,depth+1):fallback(row);
  if(type==='list')return Array.isArray(row.items)?heading+`<ul>${row.items.map((item:unknown)=>`<li>${render(item,depth+1,true)}</li>`).join('')}</ul>`:fallback(row);
  if(type==='item'||type==='itemSub')return `${title?`<strong>${rich(title)}.</strong> `:''}${render(row.entries??row.entry,depth+1,true)}`;
  if(type==='inset'||type==='insetReadaloud')return `<aside class="inset">${heading}${render(row.entries??row.entry,depth+1)}</aside>`;
  if(type==='quote')return `<blockquote>${render(row.entries,depth+1)}${row.by?`<footer>— ${rich(String(row.by))}</footer>`:''}${row.from?`<p>${rich(String(row.from))}</p>`:''}</blockquote>`;
  if(type==='table'){
   if(!Array.isArray(row.rows))return fallback(row);
   const labels=Array.isArray(row.colLabels)?row.colLabels:[],rows=Array.isArray(row.rows)?row.rows:[];
   return `${row.caption?`<h4>${rich(String(row.caption))}</h4>`:heading}<div style="max-width:100%;overflow:auto"><table>${labels.length?`<thead><tr>${labels.map((label:unknown)=>`<th>${render(label,depth+1,true)}</th>`).join('')}</tr></thead>`:''}<tbody>${rows.map((raw:unknown)=>{const cells=Array.isArray(raw)?raw:raw&&typeof raw==='object'&&Array.isArray((raw as Row).row)?(raw as Row).row:undefined;return cells?`<tr>${cells.map((cell:unknown)=>`<td>${render(cell,depth+1,true)}</td>`).join('')}</tr>`:`<tr><td>${render(raw,depth+1)}</td></tr>`;}).join('')}</tbody></table></div>${render(row.footnotes,depth+1)}`;
  }
  if(type==='cell'){
   const roll=row.roll;
   if(roll&&typeof roll==='object'&&Number.isFinite(roll.exact))return esc(String(roll.exact));
   if(roll&&typeof roll==='object'&&Number.isFinite(roll.min)&&Number.isFinite(roll.max))return esc(`${roll.min}–${roll.max}`);
   if(row.entry!==undefined)return render(row.entry,depth+1,true);
   return fallback(row);
  }
  if(type==='gallery')return Array.isArray(row.images)?heading+render(row.images,depth+1):fallback(row);
  if(type==='image'){
   const address=typeof row.href==='string'?row.href:row.href?.url||row.href?.path||'',url=imageUrl(address),label=String(row.title||row.name||tr('图片','Image'));
   return `<figure>${row.title||row.name?`<figcaption>${rich(label)}</figcaption>`:''}${url?`<button type="button" data-local-book-image="${esc(url)}" data-image-label="${esc(label)}" data-open-label="${esc(tr('展开图片','Show image'))}" data-close-label="${esc(tr('收起图片','Hide image'))}" data-error-label="${esc(tr('图片暂时无法读取，可稍后重试。','The image could not be loaded; try again later.'))}">${esc(tr('展开图片','Show image'))}</button>`:`<p class="local-book-notice">${esc(tr('图片地址未定位或暂不支持：','Image address unresolved or unsupported: '))}${esc(String(address))}</p>`}${row.credit?`<p>${rich(String(row.credit))}</p>`:''}</figure>`;
  }
  if(type==='statblockInline'&&row.dataType==='monster'&&row.data&&monster){try{return heading+monster(row.data);}catch{return fallback(row);}}
  if(type==='statblock'||type==='refClassFeature'||type==='refSubclassFeature'||type==='refOptionalfeature')return fallback(row,tr('引用正文未随本条提供，待核对','Referenced body was not provided with this document; review required'));
  return fallback(row);
 };
 const header=metadata?metadata({...data,contents:chapters.length?undefined:data.contents}):['author','published','storyline'].flatMap(field=>data[field]?[`<p><strong>${esc(({author:tr('作者','Author'),published:tr('出版','Published'),storyline:tr('故事线','Storyline')} as Row)[field])}${esc(tr('：',': '))}</strong>${rich(String(data[field]))}</p>`]:[]).join('');
 const notices=(Array.isArray(book?.notices)?book.notices:[]).map((notice:string)=>`<p class="local-book-notice">${esc(notice)}</p>`).join('');
 const label=(node:unknown,index:number)=>node&&typeof node==='object'&&!Array.isArray(node)&&typeof (node as Row).name==='string'?(node as Row).name:tr(`第 ${index+1} 节`,`Section ${index+1}`);
 const toc=chapters.length?`<nav aria-label="${esc(tr('章节目录','Chapter contents'))}">${chapters.map((node,index)=>`<button type="button" data-local-book-target="local-book-section-${index}">${rich(label(node,index))}</button>`).join(' ')}</nav>`:'';
 return header+notices+toc+`<article class="local-book-reading">${chapters.map((node,index)=>`<section id="local-book-section-${index}" data-book-chapter="${index}">${render(node)}</section>`).join('')}</article><details class="local-book-source"><summary>${esc(tr('原文结构','Original structure'))}</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${json(book?.original)}</pre></details>`;
}

/** Images load only after a player explicitly opens one. No source URL is
 * placed in an image/request element during document rendering. */
export function bindLocalBookControls(root:HTMLElement):void{
 root.addEventListener('click',event=>{
  const button=(event.target as HTMLElement|null)?.closest<HTMLButtonElement>('button');if(!button||!root.contains(button))return;
  const target=button.dataset.localBookTarget;
  if(target&&/^local-book-section-\d+$/.test(target)){root.querySelector('#'+target)?.scrollIntoView({block:'start'});return;}
  if(!button.dataset.localBookImage)return;
  const url=imageUrl(button.dataset.localBookImage),figure=button.closest('figure');if(!url||!figure)return;
  const old=figure.querySelector('img');if(old){old.remove();button.textContent=button.dataset.openLabel||'';return;}
  figure.querySelector('[data-image-error]')?.remove();button.disabled=true;
  const image=document.createElement('img');image.alt=button.dataset.imageLabel||'';image.referrerPolicy='no-referrer';image.style.maxWidth='100%';image.style.height='auto';
  image.addEventListener('load',()=>{if(figure.isConnected){button.disabled=false;button.textContent=button.dataset.closeLabel||'';}});
  image.addEventListener('error',()=>{image.remove();if(!figure.isConnected)return;button.disabled=false;button.textContent=button.dataset.openLabel||'';const message=document.createElement('p');message.dataset.imageError='';message.textContent=button.dataset.errorLabel||'';figure.append(message);});
  figure.append(image);image.src=url;
 });
}
