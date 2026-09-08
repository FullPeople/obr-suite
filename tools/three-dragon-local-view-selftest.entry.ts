import assert from "node:assert/strict";
import { applyAction, createGame, eligibleActions, projectSeat } from "../src/modules/threeDragonAnte/rules";
import { localViewParts, LocalViewReceiver } from "../src/modules/threeDragonAnte/local-view";
import type { TableView } from "../src/modules/threeDragonAnte/protocol";
let largest = 0, largestView!: TableView, steps = 0;
const serializable = (value: unknown) => JSON.parse(JSON.stringify(value));
for (let seed = 1; seed <= 6; seed++) {
  let game = createGame({ id: `large-${seed}`, seed, seats: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, name: `Player ${i}` })) });
  for (let step = 0; step < 400; step++) {
    const view: TableView = { selfPlayerId: "p0", isHost: true, connected: true, pending: false,
      table: { version: 1, id: "table", hostPlayerId: "p0", hostConnectionId: "host", hostName: "Player 0", stage: "playing", revision: step + 1,
        seats: game.seats.map((seat, i) => ({ playerId: `p${i}`, seatId: seat.id, name: seat.name })) }, game: projectSeat(game, "s0") };
    const size = new TextEncoder().encode(JSON.stringify(view)).length;
    if (size > largest) { largest = size; largestView = view; }
    const owner = game.seats.find(seat => eligibleActions(game, seat.id).length);
    if (!owner) break;
    const action = eligibleActions(game, owner.id)[0];
    const result = applyAction(game, action.kind === "choose"
      ? { id: `${seed}-${step}`, revision: game.revision, seatId: owner.id, kind: "choose", choiceId: action.choice.id, optionIds: action.choice.options.slice(0, action.choice.min).map(option => option.id) }
      : { id: `${seed}-${step}`, revision: game.revision, seatId: owner.id, kind: action.kind, cardId: action.cardIds[(step + seed) % action.cardIds.length] });
    assert.ok(result.ok); if (!result.ok) throw Error(result.error.code); game = result.state; steps++;
  }
}
assert.ok(largest > 16384, `Must reproduce actual legal game exceeding LOCAL cap; got ${largest}`);
const frames = localViewParts(largestView, "current-window", 1);
assert.ok(frames.every(frame => new TextEncoder().encode(JSON.stringify(frame)).length < 12000));
const receiver = new LocalViewReceiver("current-window");
let decoded: TableView | undefined;
for (const frame of [...frames].reverse()) decoded = receiver.receive(frame) ?? decoded;
assert.deepEqual(serializable(decoded), serializable(largestView), "Actual long game retains every discard, event and choice");
for (const frame of frames) assert.equal(receiver.receive(frame), undefined, "Already applied view cannot replay");
const previous = localViewParts(largestView, "current-window", 2);
const newer = structuredClone(largestView); newer.pending = true;
for (const frame of localViewParts(newer, "current-window", 3)) decoded = receiver.receive(frame) ?? decoded;
for (const frame of previous) assert.equal(receiver.receive(frame), undefined, "Old complete view cannot replace newer pending state");
assert.equal(decoded!.pending, true);
const multilingual = structuredClone(largestView); multilingual.message = "信息 🐉\n\"\\".repeat(1600);
const many = localViewParts(multilingual, "new-window", 1), fresh = new LocalViewReceiver("new-window");
assert.ok(many.length > 3); assert.ok(many.every(frame => JSON.stringify(frame).length < 12000));
for (const frame of many) assert.equal(receiver.receive(frame), undefined, "Other iframe nonce rejected");
for (const frame of [...many].reverse()) decoded = fresh.receive(frame) ?? decoded;
assert.deepEqual(serializable(decoded), serializable(multilingual), "UTF8, escaped characters and multi-part options are lossless");
assert.equal(fresh.receive({ ...many[0], sequence: 9, total: 100000 }), undefined);
assert.equal(fresh.receive({ ...many[0], sequence: 9, part: -1 }), undefined);
assert.equal(fresh.receive({ ...many[0], sequence: 9, payload: "!invalid!" }), undefined);
const expired = new LocalViewReceiver("new-window"); expired.receive(many[0], 0);
for (const frame of many.slice(1)) assert.equal(expired.receive(frame, 16000), undefined);
assert.deepEqual(serializable(expired.receive(many[0], 16001)), serializable(multilingual), "Missing expired fragment can be delivered again");
assert.throws(() => localViewParts({ ...largestView, message: "x".repeat(140000) }, "current-window", 4), /viewTooLarge/);
console.log(`LOCAL table views: ${steps} natural rule steps; full view maximum ${largest} bytes; card IDs + bounded fragments retain all content, reject stale/foreign/malformed frames and support retry`);
