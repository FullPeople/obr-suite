export const getState=()=>({allowPlayerMonsters:true,searchGmOnly:false,...(window as any).wbMock?.metadata?.['com.obr-suite/state'],...(window as any).wbMock?.settings,enabled:{dice:true,timeStop:true,focus:true,musicBoard:true,transitions:true,bestiary:true,characterCards:true,resourceTracker:true,portals:true,search:true,inventory:true,threeDragonAnte:true,hpBar:true,...(window as any).wbMock?.metadata?.['com.obr-suite/state']?.enabled,...(window as any).wbMock?.settings?.enabled}});
export const getLocalLang=()=> 'zh';
export const setState=async(patch:any)=>{const mock=(window as any).wbMock;if(mock.settingDelay)await new Promise(r=>setTimeout(r,mock.settingDelay));mock.settingWrites=(mock.settingWrites||0)+1;mock.settings={...mock.settings,...patch};mock.emit('metadata',mock.metadata);};
export const onStateChange=()=>()=>{};
export const onLangChange=()=>()=>{};
export const getRawMonster=()=>({name:'测试怪物',ENG_name:'Test Monster',source:'TEST',str:10,dex:12,con:12,int:8,wis:10,cha:8,hp:{average:10},ac:[12],speed:{walk:30},cr:'1/4',trait:[{name:'测试特性',entries:['用于模拟验证的自制规则。']}],action:[{name:'攻击',entries:['命中 {@hit 3}，伤害 {@damage 1d6+1}。']}]});
export const loadAllMonsters=async()=>[];
export const loadMonsterBySlug=async(_slug:string)=>getRawMonster();

export const startSceneSync=()=>{};
export const readLS=(key:string,fallback:string)=>localStorage.getItem(key)??fallback;
export const writeLS=(key:string,value:string)=>localStorage.setItem(key,value);
