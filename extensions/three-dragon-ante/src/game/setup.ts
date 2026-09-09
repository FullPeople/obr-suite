/** Validate untrusted start commands again at the serving authority. */
export function validGameSetup(value:unknown):boolean {
 if(value===undefined)return true;
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 const options=value as Record<string,unknown>;
 if(Object.keys(options).some(key=>!["startingGold","startingHand"].includes(key)))return false;
 const integer=(value:unknown,min:number,max:number)=>value===undefined||typeof value==="number"&&Number.isInteger(value)&&value>=min&&value<=max;
 return integer(options.startingGold,10,1000)&&integer(options.startingHand,3,10);
}
