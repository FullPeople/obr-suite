/** Copy JSON metadata by reading its values, including inside an SDK Immer draft.
 * structuredClone cannot read Proxy objects. This intentionally handles the JSON
 * data contract only; it also preserves optional undefined members until encoding. */
export function cloneJson<T>(value:T):T {
 if(Array.isArray(value))return value.map(item=>cloneJson(item)) as T;
 if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,cloneJson(item)])) as T;
 return value;
}
