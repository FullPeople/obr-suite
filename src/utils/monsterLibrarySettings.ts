import {getState,setState,type Language,type LibraryConfig} from "../state";
import {fetchContentJson} from "./contentRequests";
import {monsterSourceFiles} from "./monsterSourceIndex";

const loadedBooks = new Map<string,{key:string;codes:string[]}>();
const escape = (text:string) => text.replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const signature = (library:LibraryConfig) => JSON.stringify([library.baseUrl,library.indexPath,library.indexFormat]);
function bookRows(library:LibraryConfig,gm:boolean):string {
 const books=loadedBooks.get(library.id);
 if(!books||books.key!==signature(library))return "";
 const disabled=new Set((library.disabledSources??[]).map(code=>code.toLowerCase()));
 return books.codes.map(code=>`<label class="lib-source-row"><input type="checkbox" data-monster-book="${escape(code)}" ${disabled.has(code.toLowerCase())?"":"checked"} ${gm?"":"disabled"}><span style="min-width:0;overflow-wrap:anywhere">${escape(code)}</span></label>`).join("");
}

/** The embedded settings deliberately omit the old all-purpose library tab.
 * Keep the monster controls in its existing rules section. */
export function renderMonsterLibrarySettings(lang:Language,gm:boolean):string {
 const libraries=getState().libraries.filter(library=>library.indexFormat==="monster-source-index");
 if(!libraries.length)return "";
 return `<section><h3>${lang==="zh"?"怪物资料库":"Monster libraries"}</h3><p>${lang==="zh"?"开启后在图鉴和搜索中加载第三方怪物；可按来源代码选择书籍。":"Enable third-party monsters in the bestiary and search, then choose their source books."}</p>${libraries.map(library=>`<div data-monster-library="${escape(library.id)}"><div class="row"><span class="lbl">${escape(library.name)}</span><button class="tog ${library.enabled?"on":""}" data-monster-library-toggle aria-label="${lang==="zh"?"启用":"Enable"} ${escape(library.name)}" aria-pressed="${library.enabled}" ${gm?"":"disabled"}></button></div><button type="button" class="lib-sources-btn" data-monster-library-books>${lang==="zh"?"选择怪物书籍":"Choose monster books"}</button><div data-monster-book-choices>${bookRows(library,gm)}</div><p role="alert" data-monster-library-error hidden></p></div>`).join("")}</section>`;
}

export function bindMonsterLibrarySettings(root:HTMLElement,lang:Language,gm:boolean):void {
 for(const row of root.querySelectorAll<HTMLElement>("[data-monster-library]")){
  const id=row.dataset.monsterLibrary!,toggle=row.querySelector<HTMLButtonElement>("[data-monster-library-toggle]")!;
  const message=row.querySelector<HTMLElement>("[data-monster-library-error]")!,slot=row.querySelector<HTMLElement>("[data-monster-book-choices]")!;
  const current=()=>getState().libraries.find(library=>library.id===id);
  const error=(failure:unknown)=>{message.textContent=(lang==="zh"?"未保存，请重试：":"Not saved. Retry: ")+String(failure);message.hidden=false;};
  async function update(patch:Partial<LibraryConfig>):Promise<boolean>{
   message.hidden=true;
   try{await setState({libraries:getState().libraries.map(library=>library.id===id?{...library,...patch}:library)});return true;}
   catch(failure){error(failure);return false;}
  }
  const bindBooks=()=>slot.querySelectorAll<HTMLInputElement>("[data-monster-book]").forEach(checkbox=>checkbox.addEventListener("change",async()=>{
   const library=current();if(!gm||!library)return;
   const code=checkbox.dataset.monsterBook!,wasEnabled=(library.disabledSources??[]).every(value=>value.toLowerCase()!==code.toLowerCase());
   const disabled=(library.disabledSources??[]).filter(value=>value.toLowerCase()!==code.toLowerCase());
   if(!checkbox.checked)disabled.push(code);
   checkbox.disabled=true;
   const saved=await update({disabledSources:disabled});
   if(!saved)checkbox.checked=wasEnabled;
   checkbox.disabled=!gm;
  }));
  bindBooks();
  toggle.addEventListener("click",async()=>{
   const library=current();if(!gm||!library)return;
   toggle.disabled=true;await update({enabled:!library.enabled});toggle.disabled=!gm;
  });
  const books=row.querySelector<HTMLButtonElement>("[data-monster-library-books]")!;
  books.addEventListener("click",async()=>{
   const library=current();if(!library)return;
   const key=signature(library),base=library.baseUrl.replace(/\/+$/,"");
   message.hidden=true;books.disabled=true;
   try{
    const [index,properties]=await Promise.all([
     fetchContentJson(`${base}/${library.indexPath}`,{cache:"no-cache"}),
     fetchContentJson(`${base}/_generated/index-props.json`,{cache:"no-cache"}),
    ]);
    if(!index.ok||!properties.ok)throw Error(`HTTP ${!index.ok?index.status:properties.status}`);
    const codes=Object.keys(monsterSourceFiles(await index.json(),await properties.json())).sort();
    const latest=current();if(!latest||signature(latest)!==key||!slot.isConnected)return;
    loadedBooks.set(id,{key,codes});slot.innerHTML=bookRows(latest,gm);bindBooks();
    if(!codes.length){slot.textContent=lang==="zh"?"此资料库没有声明怪物书籍。":"This library declares no monster books.";}
   }catch(failure){if(message.isConnected){message.textContent=(lang==="zh"?"书籍列表读取失败，请重试：":"Book list unavailable. Retry: ")+String(failure);message.hidden=false;}}
   finally{books.disabled=false;}
  });
 }
}
