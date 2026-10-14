import {documentRevision, documentRuntime, tokenRuntime, runtimeProjectionRights,
  RUNTIME_BASELINE, type RuntimeBaseline} from './runtime-authority';
import {sameValue} from './merge';
import {bubblePresentation} from '../modules/bubbles/presentation';

type Token = {id: string; createdUserId: string; metadata: Record<string, any>};
const BIND = 'com.character-cards/boundCardId';
type Observation = {
  peek(): {items?: Token[]};
  sceneEpoch(): number;
  onChange(listener: (change: any) => void): () => void;
};

/** A new stamp is insufficient if a native editor changed its values afterwards. */
export function runtimeProjectionApplied(item: Token, cardId: string, doc: any, definitions: any[] = []) {
  if (item.metadata[BIND] !== cardId) return false;
  const rights = runtimeProjectionRights(doc, item);
  if (!Object.values(rights).some(Boolean)) return true;
  const baseline = item.metadata[RUNTIME_BASELINE] as RuntimeBaseline | undefined;
  if (baseline?.version !== 1 || baseline.cardId !== cardId || !Number.isSafeInteger(baseline.revision)
    || baseline.revision < documentRevision(doc)) return false;
  const expected = baseline.revision > documentRevision(doc) ? baseline.value : documentRuntime(doc, definitions);
  if (!expected || !expected.stats || typeof expected.stats !== 'object'
    || !expected.resources || typeof expected.resources !== 'object' || !Array.isArray(expected.conditions)) return false;
  const actual = tokenRuntime(item.metadata, {stats: {}, resources: {}, conditions: []});
  return (['stats', 'resources', 'conditions'] as const)
    .every(key => !rights[key] || sameValue(actual[key], expected[key]));
}

/** Observe local metadata application; never wait for every participant or poll SDK getters. */
export type ProjectionCompletionOptions = {
  observation: Observation; cardId: string; document: any; definitions?: any[];
  tokenIds: string[]; start(): Promise<void>; timeoutMs?: number;
};
export async function observeRuntimeProjection(options: ProjectionCompletionOptions) {
  const {observation, cardId, document, tokenIds} = options;
  const scene = observation.sceneEpoch(), timeout = options.timeoutMs ?? 2000;
  const items = await new Promise<Token[]>((resolve, reject) => {
    let settled = false, timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error, value: Token[] = []) => {
      if (settled) return; settled = true; clearTimeout(timer); unsubscribe();
      error ? reject(error) : resolve(value);
    };
    const check = () => {
      if (scene !== observation.sceneEpoch()) return finish(Error('场景已改变，棋子同步结果待核对'));
      const current = observation.peek().items ?? [];
      const targets = tokenIds.map(id => current.find(item => item.id === id));
      if (targets.some(item => !item || item.metadata[BIND] !== cardId))
        return finish(Error('棋子或角色关联已改变，场景同步结果待核对'));
      if (targets.every(item => runtimeProjectionApplied(item!, cardId, document, options.definitions)))
        finish(undefined, targets as Token[]);
    };
    const unsubscribe = observation.onChange(check);
    timer = setTimeout(() => finish(Error('资料已保存，棋子 metadata 更新尚未确认')), timeout);
    // Install the listener before dispatch: events may precede the SDK RPC response.
    try { void options.start().then(check, error => { check(); if (!settled) finish(error); }); }
    catch (error) { finish(error as Error); }
    check();
  });
  return items;
}

export async function completeRuntimeProjection(options: ProjectionCompletionOptions) {
  const started = performance.now(), timeout = options.timeoutMs ?? 2000, scene = options.observation.sceneEpoch();
  const items = await observeRuntimeProjection(options);
  if (scene !== options.observation.sceneEpoch()) throw Error('场景已改变，显示结果待核对');
  if (bubblePresentation.pending(items)) bubblePresentation.request(options.observation.peek().items ?? []);
  await bubblePresentation.waitFor(items, Math.max(0, timeout - (performance.now() - started)));
  return items;
}
