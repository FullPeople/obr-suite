// Public/seat/omniscient projection boundary and LOCAL transport mutation test.
// This is intentionally transport-only: it proves the payload contract without
// pretending to be a multiplayer or device UAT substitute.
import assert from 'node:assert/strict';
import { build } from 'rolldown';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const base = import.meta.dirname;
const out = mkdtempSync(join(tmpdir(), 'tda-privacy-'));
const source = resolve(base, 'wire.ts');
const sourceHash = () => createHash('sha256').update(readFileSync(source)).digest('hex');
const requested = process.argv.find(value => value.startsWith('--mutant='))?.slice(9);
const mutations = {
  'pack-allowlist': {
    anchor: 'return { version: 1, id: view.id, revision: view.revision, phase: view.phase,',
    replacement: 'return { ...(view as any), version: 1, id: view.id, revision: view.revision, phase: view.phase,',
    label: 'packPublic keeps only the public allowlist',
  },
  'unpack-allowlist': {
    anchor: 'version:view.version,id:view.id,revision:view.revision,phase:view.phase,variant:unpackVariant(view.variant),',
    replacement: '...(view as any),version:view.version,id:view.id,revision:view.revision,phase:view.phase,variant:unpackVariant(view.variant),',
    label: 'unpackPublic drops hostile private fields',
  },
};
if (requested) assert.ok(mutations[requested], `unknown mutation: ${requested}`);

if (!globalThis.btoa) globalThis.btoa = value => Buffer.from(value, 'binary').toString('base64');
if (!globalThis.atob) globalThis.atob = value => Buffer.from(value, 'base64').toString('binary');

const checks = [];
const check = (name, value) => { assert.ok(value, name); checks.push(name); console.log(`PASS ${name}`); };
const secretKeys = ['privateHands', 'privateCommittedAntes', 'privateHandPowerHints', 'omniscient'];
function assertNoPrivate(value, label, opponentCardId) {
  const encoded = JSON.stringify(value);
  for (const key of secretKeys) assert.equal(encoded.includes(key), false, `${label} contains ${key}`);
  assert.equal(encoded.includes(opponentCardId), false, `${label} contains opponent card ${opponentCardId}`);
}

async function compile(mutant) {
  const entry = `import { createGame, projectPublic, projectSeat, projectOmniscient } from ${JSON.stringify(resolve(base, 'rules/index.ts'))};
import { packPublic, packSeat, unpackPublic, unpackSeat } from ${JSON.stringify(source)};
import { localViewParts, LocalViewReceiver } from ${JSON.stringify(resolve(base, 'local-view.ts'))};
export { createGame, projectPublic, projectSeat, projectOmniscient, packPublic, packSeat, unpackPublic, unpackSeat, localViewParts, LocalViewReceiver };`;
  const file = join(out, `${mutant ? `mutant-${mutant}` : 'baseline'}.mjs`);
  let applied = false;
  const fixture = {
    name: 'privacy-fixture',
    resolveId(id) { return id === 'privacy-fixture' ? '\0privacy-fixture' : undefined; },
    load(id) { return id === '\0privacy-fixture' ? entry : undefined; },
  };
  const mutate = {
    name: 'privacy-mutation',
    transform(code, id) {
      if (!mutant || !id.replaceAll('\\', '/').endsWith('/wire.ts')) return;
      const change = mutations[mutant];
      const normalized = code.replaceAll('\r\n', '\n');
      assert.equal(normalized.split(change.anchor).length - 1, 1, `${mutant} anchor must be unique`);
      applied = true;
      return normalized.replace(change.anchor, change.replacement);
    },
    buildEnd() { if (mutant) assert.equal(applied, true, `${mutant} mutation was not applied`); },
  };
  await build({ input: 'privacy-fixture', plugins: [fixture, mutate], output: { file, format: 'esm', codeSplitting: false }, logLevel: 'silent' });
  return { module: await import(`${pathToFileURL(file).href}?run=${Date.now()}-${Math.random()}`), applied, file };
}

async function verify(mod) {
  const state = mod.createGame({ id: 'privacy-game', seed: 7341, seats: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
  const ownCardId = state.seats[0].hand[0];
  const opponentCardId = state.seats[1].hand[0];
  const publicView = mod.projectPublic(state);
  const seatView = mod.projectSeat(state, 'a');
  const omniscient = mod.projectOmniscient(state, 'a');
  const publicWire = mod.packPublic(omniscient);
  const seatWire = mod.packSeat(omniscient);

  check('omniscient fixture really contains host-only data', omniscient.omniscient === true && omniscient.privateHands.b.some(card => card.id === opponentCardId) && Array.isArray(omniscient.privateHandPowerHints.b));
  check('public projection excludes the opponent hand', !JSON.stringify(publicView).includes(opponentCardId));
  check('seat projection contains only the owner hand', seatView.hand.some(card => card.id === ownCardId) && !JSON.stringify(seatView).includes(opponentCardId));
  assertNoPrivate(publicWire, 'packPublic(omniscient)', opponentCardId);
  check('packPublic strips omniscient fields and opponent cards', true);
  assertNoPrivate(seatWire, 'packSeat(omniscient)', opponentCardId);
  check('packSeat retains only the current owner hand', seatWire.hand.includes(ownCardId) && !seatWire.hand.includes(opponentCardId));

  const hostilePublic = { ...publicWire, privateHands: { b: [{ id: opponentCardId }] }, privateCommittedAntes: { b: { id: 'secret-ante' } }, privateHandPowerHints: { b: [{ cardId: opponentCardId }] }, omniscient: true, injectedSecret: 'do-not-retain' };
  const hostileSeat = { ...seatWire, privateHands: { b: [{ id: opponentCardId }] }, privateCommittedAntes: { b: { id: 'secret-ante' } }, privateHandPowerHints: { b: [{ cardId: opponentCardId }] }, omniscient: true, injectedSecret: 'do-not-retain' };
  const unpackedPublic = mod.unpackPublic(hostilePublic);
  const unpackedSeat = mod.unpackSeat(hostileSeat);
  assertNoPrivate(unpackedPublic, 'unpackPublic(hostile)', opponentCardId);
  check('unpackPublic strips hostile full-view fields', !('privateHands' in unpackedPublic) && !('injectedSecret' in unpackedPublic));
  assertNoPrivate(unpackedSeat, 'unpackSeat(hostile)', opponentCardId);
  check('unpackSeat strips hostile full-view fields', !('privateHands' in unpackedSeat) && unpackedSeat.hand.some(card => card.id === ownCardId));

  const tableView = {
    actionReceiptVersion: 1,
    table: { version: 1, id: 'privacy-table', hostPlayerId: 'player-a', hostConnectionId: 'connection-a', hostName: 'A', stage: 'playing', seats: [{ playerId: 'player-a', seatId: 'a', name: 'A' }, { playerId: 'player-b', seatId: 'b', name: 'B' }], revision: state.revision },
    selfPlayerId: 'player-a', isHost: true, connected: true, pending: false, game: omniscient,
    historyPage: { gameId: 'privacy-game', before: 4, entries: [{ sequence: 1, revision: 1, phase: 'play', gambit: 1, round: 1, activeSeatId: 'a', event: { code: 'CARD_PLAYED', privateHands: { b: [{ id: opponentCardId }] } }, privateHands: { b: [{ id: opponentCardId }] } }], historyComplete: false, historyStartSequence: 1 },
  };
  const contaminatedTableView = { ...tableView, table: { ...tableView.table, privateHands: { b: [{ id: opponentCardId }] } }, privateHands: { b: [{ id: opponentCardId }] }, privateCommittedAntes: { b: { id: 'secret-ante' } }, privateHandPowerHints: { b: [{ cardId: opponentCardId }] }, omniscient: true, injectedSecret: 'do-not-retain' };
  const parts = mod.localViewParts(contaminatedTableView, 'client-a', 1);
  const localText = Buffer.from(parts.map(part => part.payload).join(''), 'base64').toString('utf8');
  assertNoPrivate(JSON.parse(localText), 'LOCAL encoded payload', opponentCardId);
  check('LOCAL payload strips omniscient fields before chunking', parts.length >= 1 && !localText.includes('privateHands'));
  const receiver = new mod.LocalViewReceiver('client-a');
  let roundTrip;
  for (const part of parts) roundTrip = receiver.receive(part) ?? roundTrip;
  assert.ok(roundTrip?.game, 'LOCAL payload reconstructs a game view');
  assertNoPrivate(roundTrip, 'LOCAL decoded receiver view', opponentCardId);
  check('LOCAL receiver returns a private seat view without full-view data', roundTrip.game.selfSeatId === 'a' && roundTrip.game.hand.some(card => card.id === ownCardId));

  const hostileLocal = JSON.parse(localText);
  hostileLocal.privateHands = { b: [{ id: opponentCardId }] };
  hostileLocal.privateCommittedAntes = { b: { id: 'secret-ante' } };
  hostileLocal.privateHandPowerHints = { b: [{ cardId: opponentCardId }] };
  hostileLocal.omniscient = true;
  const hostileBytes = Buffer.from(JSON.stringify(hostileLocal), 'utf8').toString('base64');
  const hostileParts = Array.from({ length: Math.ceil(hostileBytes.length / 10000) }, (_, part) => ({ version: 1, clientId: 'client-a', sequence: 2, part, total: Math.ceil(hostileBytes.length / 10000), payload: hostileBytes.slice(part * 10000, (part + 1) * 10000) }));
  let hostileRoundTrip;
  for (const part of hostileParts) hostileRoundTrip = receiver.receive(part) ?? hostileRoundTrip;
  assertNoPrivate(hostileRoundTrip, 'LOCAL receiver hostile envelope', opponentCardId);
  check('LOCAL receiver strips hostile top-level full-view fields', hostileRoundTrip.game.selfSeatId === 'a');

  return { checks: checks.length, parts: parts.length, ownCardId, opponentCardId };
}

const baselineHash = sourceHash();
try {
  if (requested) {
    const compiled = await compile(requested);
    try {
      await verify(compiled.module);
    } catch (error) {
      if (error instanceof assert.AssertionError) {
        writeFileSync(join(out, 'mutation.json'), JSON.stringify({ mutant: requested, applied: compiled.applied, killed: true, killedBy: error.message, evidence: out }, null, 2));
        console.log(`KILL ${requested} ${out}`);
      } else throw error;
    }
    if (readFileSync(source).length === 0) throw Error('wire source disappeared');
  } else {
    const compiled = await compile();
    const baseline = await verify(compiled.module);
    const kills = [];
    for (const name of Object.keys(mutations)) {
      const child = await compile(name);
      try {
        await verify(child.module);
      } catch (error) {
        if (error instanceof assert.AssertionError) { kills.push(name); console.log(`KILL ${name}`); }
        else throw error;
      }
    }
    assert.deepEqual(kills.sort(), Object.keys(mutations).sort(), 'every privacy mutation must be killed by a named assertion');
    writeFileSync(join(out, 'result.json'), JSON.stringify({ baseline, mutations: kills, sourceHash: baselineHash, evidence: out, scope: 'Rules projection, explicit wire allowlists and LOCAL chunk round trip. No Owlbear SDK, network, multiple windows or device UAT.' }, null, 2));
    console.log(`${baseline.checks} privacy checks and ${kills.length} mutation kills passed. Evidence: ${out}`);
  }
} catch (error) {
  writeFileSync(join(out, 'failure.json'), JSON.stringify({ sourceHash: baselineHash, error: String(error), stack: error.stack, evidence: out }, null, 2));
  throw new Error(`Privacy verification failed: ${out}`, { cause: error });
}
