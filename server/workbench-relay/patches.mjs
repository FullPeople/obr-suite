export function applyDocumentChanges(base,changes){
 if(!Array.isArray(changes)||changes.length>10000)throw Error('invalid document changes');let result=structuredClone(base);
 for(const change of changes){if(!Array.isArray(change.path)||change.path.length>64||change.path.some(k=>typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)))throw Error('invalid path');
  if(!change.path.length){result=structuredClone(change.after);continue;}let parent=result;for(const key of change.path.slice(0,-1)){if(!parent[key]||typeof parent[key]!=='object'||Array.isArray(parent[key]))parent[key]={};parent=parent[key];}const key=change.path.at(-1);if(change.remove)delete parent[key];else parent[key]=structuredClone(change.after);
 }return result;
}
