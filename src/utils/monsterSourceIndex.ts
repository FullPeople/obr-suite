import type { ContentSource } from "./contentLocale";
import { mapWithConcurrency } from "./contentRequests";

/** Collections are relative to the configured library, never another host. */
export function safeCollectionPath(value: unknown): value is string {
  if (typeof value !== "string" || !value.endsWith(".json")) return false;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return false; }
  return !/^[a-z][a-z\d+.-]*:|^[\\/]|[?#\\]/i.test(decoded) &&
    !decoded.split("/").some(part => !part || part === "." || part === "..");
}

/** A source index can alias several books to one collection. The property
 * index keeps unrelated adventures, races and spells out of the monster load. */
export function monsterSourceFiles(index: unknown, properties: unknown): Record<string, string> {
  if (!index || typeof index !== "object" || Array.isArray(index) ||
      !properties || typeof properties !== "object" || Array.isArray(properties)) throw Error("Invalid homebrew source index");
  const monsters = (properties as Record<string, unknown>).monster;
  if (monsters !== undefined && (!monsters || typeof monsters !== "object" || Array.isArray(monsters))) throw Error("Invalid homebrew monster index");
  const allowed = new Set(Object.keys(monsters ?? {}).filter(safeCollectionPath));
  return Object.fromEntries(Object.entries(index).filter((pair): pair is [string, string] =>
    safeCollectionPath(pair[1]) && allowed.has(pair[1])));
}

/** Search and its detail reader retain the collection path instead of
 * guessing a core bestiary filename from the source code. */
export async function collectionMonsterSearchIndex(
  source: ContentSource,
  read: (path: string) => Promise<any>,
  unavailable: (path: string, error: unknown) => void,
) {
  const files = monsterSourceFiles(await read(source.indexPath), await read("_generated/index-props.json"));
  const paths = [...new Set(Object.entries(files).filter(([code]) => !source.disabledSources.has(code.toLowerCase())).map(([, path]) => path))];
  const groups = await mapWithConcurrency(paths, 2, async collectionPath => {
    try {
      const body = await read(collectionPath);
      if (!Array.isArray(body?.monster)) throw Error("Invalid monster collection");
      return body.monster.filter((monster: any) => monster && typeof monster.name === "string" && typeof monster.source === "string" &&
        !source.disabledSources.has(monster.source.toLowerCase()))
        .map((monster: any) => ({id:0,c:1,n:String(monster.ENG_name || monster.name),cn:String(monster.name),s:String(monster.source),u:"",collectionPath}));
    } catch (error) {
      unavailable(collectionPath, error);
      return [];
    }
  });
  return {x:groups.flat().map((entry,id)=>({...entry,id})),m:{s:{}}};
}
