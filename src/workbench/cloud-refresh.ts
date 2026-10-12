/** Publish each completed card without waiting for another card's failed read. */
export async function refreshCloudIndependently<T>(cards:T[],read:(card:T)=>Promise<unknown>,publish:()=>Promise<unknown>,failed:(card:T,error:unknown)=>void){
 return Promise.allSettled(cards.map(async card=>{try{await read(card);}catch(error){failed(card,error);}finally{await publish();}}));
}
