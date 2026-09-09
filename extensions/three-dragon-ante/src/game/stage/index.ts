import * as THREE from "three";
import { readHandGesture, type HandGesture } from "../gesture";
import type { PublicEvent, SeatView } from "../rules/types";
import { card } from "../rules/cards";
import { cardTexture, labelTexture, woodTexture, feltTexture } from "./textures";
import { placements, seatPlacements, coinDenominations, DECK, DISCARD, STAKES, pileTop, type Pose, type CardPlacement } from "./layout";
import type { StageAnchorQuery, StageHandle, StageHit, StageModel, StageOptions, StageZone } from "./types";
import { REVEAL_PRESENTATION_MS, type RevealPhase } from "./types";
export type * from "./types";

interface Visual { group: THREE.Group; body: THREE.Mesh; front: THREE.Mesh; back: THREE.Mesh; effectGlow: THREE.Mesh; faceKey: string; placement: CardPlacement }
interface Motion { object: THREE.Object3D; start: number; duration: number; from: Pose; to: Pose; arc: number; flip: boolean; bounce: boolean; done?: () => void }
interface RevealData { gameId: string; gambit: number; cards: { placement: CardPlacement; from: Pose }[]; allTied: boolean; payments: { seatId: string; amount: number }[] }
interface RevealCue { data: RevealData; start: number; cards: Visual[]; labels: THREE.Mesh[]; highlights: THREE.Mesh[]; flipped: boolean; paid: boolean }
const W = 1.28, H = 1.85, THICKNESS = .045;
const last = <T>(values: readonly T[]): T | undefined => values[values.length - 1];
const copyPose = (object: THREE.Object3D): Pose => ({ x: object.position.x, y: object.position.y, z: object.position.z, yaw: object.rotation.y, tilt: object.rotation.x, roll: object.rotation.z, scale: object.scale.x });
const setPose = (object: THREE.Object3D, pose: Pose) => { object.position.set(pose.x, pose.y, pose.z); object.rotation.set(pose.tilt, pose.yaw, pose.roll ?? 0, "YXZ"); object.scale.setScalar(pose.scale); };
const poseEquals = (a: Pose, b: Pose) => ["x", "y", "z", "yaw", "tilt", "scale", "roll"].every(key => Math.abs(((a as any)[key] ?? 0) - ((b as any)[key] ?? 0)) < .00001);

/** A projections-only, event-driven Three.js surface. No game transport or input listeners. */
export function mountTableStage(canvas: HTMLCanvasElement, options: StageOptions = {}): StageHandle {
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "low-power" }); }
  catch { options.onQuality?.({ webgl: false, quality: "unavailable", reason: "creation-failed" });
    let dead = false; return { update() {}, hitTest: () => null, getAnchor: () => null, setDrag() {}, releaseDrag() {}, resolvePending() {}, gesture() {}, suspend() {}, resume() {}, destroy() { dead = true; }, diagnostics: () => ({ frames: 0, animations: 0, meshes: 0, textures: 0, drawCalls: 0, suspended: true, destroyed: dead, pendingCardId: null, faceCardIds: [] }) }; }
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.22;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75)); renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene(); scene.background = new THREE.Color("#161211");
  const camera = new THREE.OrthographicCamera(-12, 12, 8, -8, .1, 80);
  camera.position.set(0, 17, 13.5); camera.lookAt(0, 0, .55);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  const geo = <T extends THREE.BufferGeometry>(value: T) => { geometries.add(value); return value; };
  const mat = <T extends THREE.Material>(value: T) => { materials.add(value); return value; };
  const tex = <T extends THREE.Texture>(value: T) => { textures.add(value); return value; };
  const standard = (color: THREE.ColorRepresentation, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => mat(new THREE.MeshStandardMaterial({ color, roughness: .78, ...extra }));
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D = scene) => { const result = new THREE.Mesh(geometry, material); parent.add(result); return result; };
  const wood = tex(woodTexture()); const woodMat = standard("#aa8666", { map: wood });
  const table = mesh(geo(new THREE.CylinderGeometry(9.65, 9.45, .5, 80)), woodMat); table.scale.z = .75; table.position.y = -.29; table.receiveShadow = true;
  const felt = mesh(geo(new THREE.CylinderGeometry(8.4, 8.4, .035, 80)), standard("#193d39", { map: tex(feltTexture()), roughness: 1 })); felt.scale.z = .72; felt.position.y = -.013; felt.receiveShadow = true;
  const rim = mesh(geo(new THREE.TorusGeometry(8.55, .022, 5, 100)), standard("#a78545", { metalness: .65, roughness: .45 })); rim.rotation.x = -Math.PI / 2; rim.scale.y = .72; rim.position.y = .008;
  const seal = mesh(geo(new THREE.RingGeometry(2.9, 2.915, 80)), standard("#6b7050", { transparent: true, opacity: .3 })); seal.rotation.x = -Math.PI / 2; seal.position.y = .011;
  const ambient = new THREE.HemisphereLight("#ffe5b7", "#252b29", 2.3); scene.add(ambient);
  const key = new THREE.DirectionalLight("#ffeacb", 3.0); key.position.set(-5, 11, 6); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -12; key.shadow.camera.right = 12; key.shadow.camera.top = 11; key.shadow.camera.bottom = -11; key.shadow.normalBias = .025; key.shadow.bias = -.0003; key.shadow.intensity = .45; scene.add(key);
  const fill = new THREE.PointLight("#bdcbd7", 50, 35, 2); fill.position.set(6, 8, -5); scene.add(fill);
  const cardBody = geo(new THREE.BoxGeometry(W, THICKNESS, H));
  const cardPlane = geo(new THREE.PlaneGeometry(W - .025, H - .025));
  const edgeMat = standard("#b29b76", { roughness: .82 });
  const backMat = standard("#ffffff", { map: tex(cardTexture(null, "en")), roughness: .77 });
  const faces = new Map<string, THREE.MeshStandardMaterial>();
  const visuals = new Map<string, Visual>(), motions = new Map<THREE.Object3D, Motion>();
  const zoneGroup = new THREE.Group(), infoGroup = new THREE.Group(), moneyGroup = new THREE.Group(), stackGroup = new THREE.Group(), transferGroup = new THREE.Group(), revealGroup = new THREE.Group(); scene.add(zoneGroup, infoGroup, moneyGroup, stackGroup, transferGroup, revealGroup);
  const stakesAnchor = new THREE.Object3D(); stakesAnchor.position.set(STAKES.x, STAKES.y, STAKES.z); scene.add(stakesAnchor);
  const zoneGeo = geo(new THREE.PlaneGeometry(W * 1.18, H * 1.1));
  const labelGeo = geo(new THREE.PlaneGeometry(1, 160 / 768));
  const zoneBorderGeo = geo(new THREE.EdgesGeometry(zoneGeo));
  const zoneBorderMat = mat(new THREE.LineBasicMaterial({ color: "#b3965d", transparent: true, opacity: .3 }));
  const zoneMaterial = standard("#ad8b55", { transparent: true, opacity: .06, depthWrite: false });
  const activeZoneBorderMat = mat(new THREE.LineBasicMaterial({ color: "#f1d89a", transparent: true, opacity: .95 }));
  const activeZoneMaterial = standard("#e7c781", { transparent: true, opacity: .23, depthWrite: false });
  const priceGlowGeo = geo(new THREE.PlaneGeometry(W * 1.11, H * 1.08));
  const priceGlowMat = mat(new THREE.MeshBasicMaterial({ color: "#ffdb76", transparent: true, opacity: .85, depthWrite: false, toneMapped: false }));
  const effectGlowGeo = geo(new THREE.PlaneGeometry(W * 1.16, H * 1.11));
  const effectGlowMat = mat(new THREE.MeshBasicMaterial({ color: "#ffd67b", transparent: true, opacity: .7, depthWrite: false, toneMapped: false }));
  const coinGeo = geo(new THREE.CylinderGeometry(.16, .16, .038, 20));
  const goldMat = standard("#d5a34d", { metalness: .78, roughness: .3 });
  const silverMat = standard("#b6bcc2", { metalness: .82, roughness: .3 });
  const dragLineGeo = geo(new THREE.BufferGeometry()); dragLineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(25 * 3), 3));
  const dragLine = new THREE.Line(dragLineGeo, mat(new THREE.LineBasicMaterial({ color: "#e5c280", transparent: true, opacity: .65, depthTest: false })));
  dragLine.visible = false; dragLine.renderOrder = 10; scene.add(dragLine);
  const landing = mesh(geo(new THREE.RingGeometry(.62, .66, 40)), mat(new THREE.MeshBasicMaterial({ color: "#f0ce83", transparent: true, opacity: .8, depthWrite: false }))); landing.rotation.x = -Math.PI / 2; landing.visible = false;
  let model: StageModel = { view: null, language: "en" }, previousView: StageModel["view"] = null;
  let destroyed = false, explicitSuspend = false, contextLost = false, raf = 0, frames = 0, width = 0, height = 0;
  let drag: { cardId: string; origin: Pose; offsetX: number; offsetY: number } | null = null, pending: { cardId: string; gameId: string } | null = null;
  let zoneSignature = "", infoSignature = "";
  const revealQueue: RevealData[] = [];
  const deferredMoney: { before: NonNullable<StageModel["view"]>; after: NonNullable<StageModel["view"]> }[] = [];
  let revealCue: RevealCue | null = null;
  let revealPhase: RevealPhase | null = null;
  const PLACE_MS = 250, FLIP_MS = 360, FLASH_MS = 640, PAYMENT_MS = REVEAL_PRESENTATION_MS - PLACE_MS - FLIP_MS - FLASH_MS;
  const gestureValues = new Map<string, { value: HandGesture; expires: number; timer: ReturnType<typeof setTimeout> }>();
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const fanRotation = new THREE.Quaternion(), fanTurn = new THREE.Quaternion();
  const fanAxis = new THREE.Vector3(0, 0, 1), faceUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const fanEuler = new THREE.Euler(0, 0, 0, "YXZ");
  const hidden = () => explicitSuspend || contextLost || document.hidden || width <= 0 || height <= 0;
  const face = (placement: CardPlacement) => {
    if (!placement.card) return { material: backMat, key: "back" };
    const id = `${model.language}:${placement.card.id}`;
    let material = faces.get(id); if (!material) { material = standard("#fffaf0", { map: tex(cardTexture(placement.card, model.language)), roughness: .74 }); faces.set(id, material); }
    return { material, key: id };
  };
  function requestFrame() { if (!destroyed && !hidden() && !raf) raf = requestAnimationFrame(tick); }
  function finishMotions() { for (const motion of [...motions.values()]) { setPose(motion.object, motion.to); motion.done?.(); } motions.clear(); }
  function tick(now: number) {
    raf = 0; if (destroyed || hidden()) return;
    tickReveal(now);
    for (const [object, motion] of motions) {
      const t = Math.max(0, Math.min(1, (now - motion.start) / motion.duration));
      const ease = t * t * (3 - 2 * t), p = motion.from, q = motion.to;
      const bounce = motion.bounce && t > .82 ? Math.sin((t - .82) / .18 * Math.PI) * .035 : 0;
      setPose(object, { x: THREE.MathUtils.lerp(p.x, q.x, ease), y: THREE.MathUtils.lerp(p.y, q.y, ease) + Math.sin(Math.PI * t) * motion.arc + bounce,
        z: THREE.MathUtils.lerp(p.z, q.z, ease), yaw: THREE.MathUtils.lerp(p.yaw, q.yaw, ease), tilt: THREE.MathUtils.lerp(p.tilt, q.tilt, ease),
        roll: THREE.MathUtils.lerp(p.roll ?? 0, q.roll ?? 0, ease) + (motion.flip ? Math.PI * (1 - ease) : 0), scale: THREE.MathUtils.lerp(p.scale, q.scale, ease) });
      if (t >= 1) { setPose(object, q); motions.delete(object); motion.done?.(); }
    }
    renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); frames++;
    if (motions.size || revealCue) requestFrame();
  }
  function move(object: THREE.Object3D, to: Pose, animate: boolean, arc = .7, flip = false, done?: () => void, duration = 470) {
    if (!animate || model.reducedMotion || hidden()) { motions.delete(object); setPose(object, to); done?.(); return; }
    motions.set(object, { object, from: copyPose(object), to, start: performance.now(), duration, arc, flip, bounce: arc > 0, done });
  }
  function freeOwnedGroup(group: THREE.Group) {
    for (const child of [...group.children]) { motions.delete(child); group.remove(child); child.traverse(node => { if ((node as THREE.InstancedMesh).isInstancedMesh) (node as THREE.InstancedMesh).dispose(); const owned = node.userData.ownedMaterial as THREE.MeshBasicMaterial | undefined;
      if (owned) { if (owned.map) { textures.delete(owned.map); owned.map.dispose(); } materials.delete(owned); owned.dispose(); } }); }
  }
  function label(parent: THREE.Object3D, text: string, position: THREE.Vector3, size = 2.8, muted = false) {
    const material = mat(new THREE.MeshBasicMaterial({ map: tex(labelTexture(text, muted)), transparent: true, depthWrite: false, toneMapped: false }));
    const object = mesh(labelGeo, material, parent); object.scale.setScalar(size); object.userData.ownedMaterial = material;
    object.position.copy(position); object.quaternion.copy(camera.quaternion); return object;
  }
  function newEvents(before: NonNullable<StageModel["view"]>, after: NonNullable<StageModel["view"]>): PublicEvent[] {
    // Public logs have no event ID and are capped. Only consume an adjacent
    // projection's provable suffix; never replay a reconnect's historical log.
    if (!before.events.length) return after.events;
    const old = before.events.map(event => JSON.stringify(event)), next = after.events.map(event => JSON.stringify(event));
    for (let count = Math.min(old.length, next.length); count > 0; count--) {
      if (old.slice(-count).every((event, index) => event === next[index])) return after.events.slice(count);
    }
    return [];
  }
  function prepareReveal(before: NonNullable<StageModel["view"]>, after: NonNullable<StageModel["view"]>): RevealData | null {
    const events = newEvents(before, after), index = events.findIndex(event => event.code === "ANTE_REVEALED");
    if (index < 0) return null;
    const ids = events[index].cardIds;
    if (!ids || ids.length !== after.seats.length || new Set(ids).size !== ids.length) return null;
    const seats = seatPlacements(after), cards: RevealData["cards"] = [];
    for (let i = 0; i < ids.length; i++) {
      let value; try { value = card(ids[i]); } catch { return null; }
      const seat = seats.find(seat => seat.id === after.seats[i].id)!;
      const old = [...visuals.values()].find(visual => visual.placement.zone === "ante" && visual.placement.seatId === seat.id) ??
        [...visuals.values()].find(visual => visual.placement.zone === "hand" && visual.placement.cardId === value.id && visual.placement.seatId === seat.id) ??
        last([...visuals.values()].filter(visual => visual.placement.zone === "hand" && visual.placement.seatId === seat.id));
      cards.push({ placement: { key: value.id, cardId: value.id, card: value, zone: "ante", seatId: seat.id, pose: { ...seat.ante, y: .15 } }, from: old ? copyPose(old.group) : { ...seat.ante, y: .15 } });
    }
    const following = events.slice(index + 1), allTied = following.some(event => event.code === "ANTE_ALL_TIED");
    const payments = allTied ? [] : following.slice(0, after.seats.length).filter(event => event.code === "PAID_STAKES" && event.seatId && after.seats.some(seat => seat.id === event.seatId) && Number.isFinite(event.amount) && event.amount! > 0)
      .map(event => ({ seatId: event.seatId!, amount: event.amount! }));
    return { gameId: after.id, gambit: after.gambit, cards, allTied, payments };
  }
  function makeVisual(placement: CardPlacement, parent: THREE.Object3D = scene): Visual {
    const group = new THREE.Group(); parent.add(group);
    const body = mesh(cardBody, edgeMat, group); body.castShadow = true; body.receiveShadow = true;
    const front = mesh(cardPlane, backMat, group); front.rotation.x = -Math.PI / 2; front.position.y = THICKNESS / 2 + .001; front.receiveShadow = true;
    const back = mesh(cardPlane, backMat, group); back.rotation.x = Math.PI / 2; back.position.y = -THICKNESS / 2 - .001;
    const effectGlow = mesh(effectGlowGeo, effectGlowMat, group); effectGlow.rotation.x = -Math.PI / 2; effectGlow.position.y = .011; effectGlow.visible = false;
    return { group, body, front, back, effectGlow, faceKey: "back", placement };
  }
  function syncEffectGlows() {
    const active = new Set(model.activeEffectCardIds ?? []), view = model.view;
    const publicIds = new Set(view ? [...view.ante, ...view.discard, ...view.revealed, ...view.seats.flatMap(seat => seat.flight.map(entry => entry.card))].map(value => value.id) : []);
    for (const visual of [...visuals.values(), ...(revealCue?.cards ?? [])]) {
      const id = visual.placement.cardId;
      // Temporary reveal faces are from a new, already public ANTE_REVEALED
      // event. Never turn an active ID into private face or texture knowledge.
      const publicFace = !!id && (publicIds.has(id) || !!revealCue?.cards.includes(visual));
      visual.effectGlow.visible = publicFace && visual.faceKey !== "back" && active.has(id!);
    }
  }
  function presentationVisibility() {
    const active = revealCue?.data;
    for (const visual of visuals.values()) visual.group.visible = !active || visual.placement.key === pending?.cardId || visual.placement.key === drag?.cardId ||
      !(active.cards.some(card => card.placement.cardId === visual.placement.cardId) || visual.placement.zone === "ante" && active.cards.some(card => card.placement.seatId === visual.placement.seatId));
    for (const visual of revealCue?.cards ?? []) visual.group.visible = visual.placement.cardId !== pending?.cardId && visual.placement.cardId !== drag?.cardId;
    syncEffectGlows();
  }
  function startReveal(data: RevealData) {
    if (destroyed || hidden() || model.reducedMotion) return;
    const cards = data.cards.map(source => { const visual = makeVisual(source.placement, revealGroup); setPose(visual.group, source.from); move(visual.group, source.placement.pose, true, poseEquals(source.from, source.placement.pose) ? 0 : .5, false, undefined, PLACE_MS); return visual; });
    const highest = Math.max(...data.cards.map(source => source.placement.card!.strength));
    const labels = data.cards.filter(source => source.placement.card!.strength === highest).map(source => {
      const pose = source.placement.pose, object = label(revealGroup, String(highest), new THREE.Vector3(pose.x, .75, pose.z), 2.0); object.visible = false; return object;
    });
    const highlights = cards.filter(visual => visual.placement.card!.strength === highest).map(visual => {
      const object = mesh(priceGlowGeo, priceGlowMat, visual.group); object.rotation.x = -Math.PI / 2; object.position.y = .012; object.visible = false; return object;
    });
    revealCue = { data, start: performance.now(), cards, labels, highlights, flipped: false, paid: false };
    notifyReveal("placing");
    presentationVisibility(); requestFrame();
  }
  function notifyReveal(phase: RevealPhase | null) { if (phase === revealPhase) return; revealPhase = phase; options.onRevealPhase?.(phase); }
  function clearReveal() {
    revealCue = null; revealQueue.length = 0; deferredMoney.length = 0; freeOwnedGroup(revealGroup); presentationVisibility(); notifyReveal(null);
  }
  function tickReveal(now: number) {
    const cue = revealCue; if (!cue) return;
    const elapsed = now - cue.start;
    if (!cue.flipped && elapsed >= PLACE_MS) {
      cue.flipped = true; notifyReveal("revealing");
      for (const visual of cue.cards) { const material = face(visual.placement); visual.front.material = material.material; visual.faceKey = material.key; move(visual.group, visual.placement.pose, true, 0, true, undefined, FLIP_MS); }
      syncEffectGlows();
    }
    const flashing = elapsed - PLACE_MS - FLIP_MS;
    // Two finite flashes of the actual maximum (including every tied maximum).
    if (flashing >= 0 && flashing < FLASH_MS) notifyReveal("price");
    for (const object of [...cue.labels, ...cue.highlights]) object.visible = flashing >= 0 && flashing < FLASH_MS && flashing % (FLASH_MS / 2) < FLASH_MS / 4;
    if (!cue.paid && flashing >= FLASH_MS) {
      cue.paid = true; notifyReveal(cue.data.allTied ? "discard" : "payment");
      if (cue.data.allTied) cue.cards.forEach((visual, index) => move(visual.group, { ...DISCARD, y: .16 + index * .006 }, true, .6, false, undefined, PAYMENT_MS));
      else animatePayments(cue.data.payments);
    }
    if (flashing >= FLASH_MS + PAYMENT_MS) {
      freeOwnedGroup(revealGroup); revealCue = null;
      const next = revealQueue.shift(); if (next) startReveal(next); else {
        presentationVisibility(); notifyReveal(null);
        for (const transfer of deferredMoney.splice(0)) animateMoney(transfer.before, transfer.after);
      }
    }
  }
  function rebuildZones() {
    const view = model.view, selfId = view && "selfSeatId" in view ? view.selfSeatId : null;
    const legal = model.connected !== false && !pending ? model.legalDropZone ?? null : null;
    const signature = JSON.stringify([view?.id, view?.seats.map(s => s.id), selfId, model.language, legal]);
    if (signature === zoneSignature) return; zoneSignature = signature; freeOwnedGroup(zoneGroup);
    const zone = (kind: StageZone, pose: Pose, seatId?: string) => {
      const active = !!selfId && seatId === selfId && kind === legal;
      const object = mesh(zoneGeo, active ? activeZoneMaterial : zoneMaterial, zoneGroup); object.rotation.x = -Math.PI / 2; object.rotation.z = -pose.yaw; object.position.set(pose.x, .027, pose.z);
      object.userData.highlight = active;
      object.userData.hit = { kind: "zone", zone: kind, ...(seatId ? { seatId } : {}) } satisfies StageHit;
      const border = new THREE.LineSegments(zoneBorderGeo, active ? activeZoneBorderMat : zoneBorderMat);
      object.add(border);
      if (kind !== "stakes") label(zoneGroup, model.language === "zh" ? ({ ante: "暗置区", flight: "牌阵", deck: "牌库", discard: "弃牌", hand: "手牌" }[kind]) : kind.toUpperCase(), new THREE.Vector3(pose.x, .035, pose.z + 1.08), 1.35, true);
    };
    zone("deck", DECK); zone("discard", DISCARD);
    if (view) for (const seat of seatPlacements(view)) { zone("ante", seat.ante, seat.id); zone("flight", seat.flight, seat.id); }
  }
  function moneyLocation(seatId: string) {
    if (seatId === "stakes") return new THREE.Vector3(STAKES.x, .07, STAKES.z);
    const seat = model.view && seatPlacements(model.view).find(s => s.id === seatId);
    return seat ? new THREE.Vector3(seat.x + Math.cos(seat.angle) * 2.25, .08, seat.z - Math.sin(seat.angle) * 2.25) : new THREE.Vector3(0, .08, -2.7);
  }
  function refreshInfo() {
    const view = model.view, signature = JSON.stringify([model.language, view?.id, view?.seats.map(s => [s.id, s.name, s.gold, s.debt, s.strength]), view?.stakes, view?.deckCount, view?.discard.length, view?.activeSeatId]);
    if (signature === infoSignature) return; infoSignature = signature; freeOwnedGroup(infoGroup); freeOwnedGroup(moneyGroup); freeOwnedGroup(stackGroup);
    if (!view) { label(infoGroup, model.language === "zh" ? "三龙牌" : "THREE DRAGON ANTE", new THREE.Vector3(0, .5, 0), 5); return; }
    // Only anonymous paper edges beneath the exposed top card. Public counts
    // determine height; at most two draw calls and sixteen representative layers.
    const cardStack = (pose: Pose, count: number, step: number) => {
      if (count < 2) return;
      const height = pileTop(count, step) - THICKNESS / 2 - .004;
      const layers = Math.min(8, count - 1), spacing = height / layers;
      const instances = new THREE.InstancedMesh(cardBody, edgeMat, layers);
      const transform = new THREE.Object3D(); instances.castShadow = true; instances.receiveShadow = true;
      for (let i = 0; i < layers; i++) {
        transform.position.set(pose.x, .004 + (i + .5) * spacing, pose.z);
        transform.rotation.y = pose.yaw; transform.scale.set(1, spacing * .95 / THICKNESS, 1);
        transform.updateMatrix(); instances.setMatrixAt(i, transform.matrix);
      }
      stackGroup.add(instances);
    };
    cardStack(DECK, view.deckCount, .005); cardStack(DISCARD, view.discard.length, .004);
    const pile = (id: string, amount: number) => {
      const pos = moneyLocation(id), denominations = coinDenominations(amount);
      // Mesh counts are bounded stacks; the adjacent label is the exact LE gold
      // total. Silver is decorative equivalent change, never a game resource.
      for (const [metal, count] of [[goldMat, Math.min(24, denominations.gold)], [silverMat, denominations.silver]] as const) {
        if (!count) continue;
        const instances = new THREE.InstancedMesh(coinGeo, metal, count); const transform = new THREE.Object3D(); instances.castShadow = true; instances.receiveShadow = true;
        for (let i = 0; i < count; i++) { const stack = Math.floor(i / 6); transform.position.set(pos.x + (metal === silverMat ? -.45 : stack * .26), pos.y + (i % 6) * .039, pos.z + (metal === silverMat ? .28 : stack % 2 * .18)); transform.rotation.y = i * .53; transform.updateMatrix(); instances.setMatrixAt(i, transform.matrix); }
        moneyGroup.add(instances);
      }
      label(infoGroup, `${amount} ${model.language === "zh" ? "金币" : "GOLD"}`, pos.clone().add(new THREE.Vector3(.3, .2, .62)), 1.8);
    };
    pile("stakes", view.stakes);
    for (const seat of seatPlacements(view)) {
      const value = view.seats.find(s => s.id === seat.id)!; pile(seat.id, value.gold);
      const active = view.activeSeatId === seat.id ? "◆ " : "";
      label(infoGroup, active + value.name, new THREE.Vector3(seat.x + (seat.self ? 0 : Math.sin(seat.angle) * 1.7), .42, seat.z + (seat.self ? .15 : Math.cos(seat.angle) * 1.7)), 3.0);
      if (value.debt) label(infoGroup, `${model.language === "zh" ? "欠债" : "Debt"} ${value.debt}`, moneyLocation(seat.id).add(new THREE.Vector3(.3, .2, 1)), 1.8, true);
    }
    label(infoGroup, String(view.deckCount), new THREE.Vector3(DECK.x, .15, DECK.z - 1.4), 1);
    label(infoGroup, String(view.discard.length), new THREE.Vector3(DISCARD.x, .15, DISCARD.z - 1.4), 1);
  }
  function animateMoney(before: StageModel["view"], view = model.view) {
    if (!view || !before || model.reducedMotion) return;
    const old = new Map(before.seats.map(s => [s.id, s.gold])); old.set("stakes", before.stakes);
    const next = new Map(view.seats.map(s => [s.id, s.gold])); next.set("stakes", view.stakes);
    const loss: [string, number][] = [], gain: [string, number][] = [];
    for (const [id, amount] of next) { const delta = amount - (old.get(id) ?? amount); if (delta > 0) gain.push([id, delta]); if (delta < 0) loss.push([id, -delta]); }
    // Only pair visible net deficits and gains. Never invent transfers from a
    // hidden hand, unresolved debt or an unobserved historical event.
    let budget = 12;
    for (const source of loss) for (const target of gain) {
      const amount = Math.min(source[1], target[1]); if (!amount) continue; source[1] -= amount; target[1] -= amount;
      for (let i = 0; i < Math.min(amount, 4) && budget-- > 0; i++) {
        const object = mesh(coinGeo, goldMat, transferGroup); object.castShadow = true; const from = moneyLocation(source[0]), to = moneyLocation(target[0]);
        object.position.copy(from).add(new THREE.Vector3(i * .08, .35, 0));
        move(object, { x: to.x + i * .06, y: .35, z: to.z, yaw: i * .7, tilt: 0, scale: 1 }, true, 1.5 + i * .08, false, () => { transferGroup.remove(object); });
      }
    }
  }
  function animatePayments(payments: RevealData["payments"]) {
    let budget = 12;
    for (const payment of payments) for (let i = 0; i < Math.min(4, payment.amount) && budget-- > 0; i++) {
      const object = mesh(coinGeo, goldMat, transferGroup); object.castShadow = true;
      const from = moneyLocation(payment.seatId), to = moneyLocation("stakes"); object.position.copy(from).add(new THREE.Vector3(i * .08, .35, 0));
      object.userData.payment = { ...payment };
      move(object, { x: to.x + i * .06, y: .35, z: to.z, yaw: i * .7, tilt: 0, scale: 1 }, true, 1.5 + i * .08, false, () => transferGroup.remove(object), PAYMENT_MS);
    }
  }
  function adjusted(placement: CardPlacement): Pose {
    const value = { ...placement.pose };
    if (placement.zone === "hand" && placement.card && model.view && "selfSeatId" in model.view && width && height) {
      const hand = (model.view as SeatView).hand, index = hand.findIndex(c => c.id === placement.cardId);
      const offset = index - (hand.length - 1) / 2;
      const cardPixels = Math.max(95, Math.min(144, width * .12));
      const spacing = Math.min(cardPixels * .73, Math.max(10, (width - 32 - cardPixels) / Math.max(1, hand.length - 1)));
      const x = width / 2 + offset * spacing, y = height - cardPixels * .89 - 36 + Math.min(36, offset * offset * 2);
      const ndc = new THREE.Vector3(x / width * 2 - 1, 1 - y / height * 2, -1).unproject(camera);
      const direction = camera.getWorldDirection(new THREE.Vector3());
      const handPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(direction, new THREE.Vector3(0, 3.5, 5));
      const point = new THREE.Ray(ndc, direction).intersectPlane(handPlane, new THREE.Vector3());
      if (point) {
        point.addScaledVector(direction, -index * .32); value.x = point.x; value.y = point.y; value.z = point.z;
        // Fan inside the camera-facing card plane, instead of yawing around
        // the table's vertical axis and merely squashing the edge cards.
        fanRotation.copy(camera.quaternion).multiply(fanTurn.setFromAxisAngle(fanAxis, -offset * .075)).multiply(faceUp);
        fanEuler.setFromQuaternion(fanRotation, "YXZ");
        value.tilt = fanEuler.x; value.yaw = fanEuler.y; value.roll = fanEuler.z;
        value.scale = cardPixels / (width / (camera.right - camera.left)) / W;
      }
    }
    if (placement.zone === "hand" && placement.cardId && model.selectedCardIds?.includes(placement.cardId)) { value.y += .38; value.z -= .12; }
    if (!placement.card && placement.zone === "hand" && placement.seatId) {
      const gesture = gestureValues.get(placement.seatId)?.value;
      const parts = placement.key.split(":"); const index = Number(parts[parts.length - 1]);
      if (gesture && (gesture.hover === index || gesture.selected.includes(index))) { value.y += .4; value.tilt += .15; }
    }
    return value;
  }
  function reconcile(animate: boolean) {
    const desired = new Map((model.view ? placements(model.view) : []).map(p => [p.key, p]));
    const sourcePoses = new Map<string, Pose>();
    if (animate) for (const [id, placement] of desired) {
      if (visuals.has(id) || !placement.seatId || !["ante", "flight"].includes(placement.zone)) continue;
      // Reuse an outgoing anonymous mesh when possible. Its ordinal is only a
      // visual source, never evidence of what that opponent previously held.
      const candidates = [...visuals.entries()].filter(([key, value]) => key !== pending?.cardId && key !== drag?.cardId && value.placement.seatId === placement.seatId &&
        (placement.zone === "ante" && value.placement.zone === "ante" && !desired.has(key) || value.placement.zone === "hand" && !value.placement.card));
      const source = candidates.find(([key, value]) => value.placement.zone === "ante" && !desired.has(key)) ?? candidates.find(([key]) => !desired.has(key)) ?? last(candidates);
      if (source) {
        sourcePoses.set(id, copyPose(source[1].group));
        if (!desired.has(source[0])) { visuals.delete(source[0]); visuals.set(id, source[1]); }
      }
    }
    for (const [id, visual] of visuals) if (!desired.has(id) && pending?.cardId !== id && drag?.cardId !== id) { motions.delete(visual.group); scene.remove(visual.group); visuals.delete(id); }
    for (const [id, placement] of desired) {
      let visual = visuals.get(id); const fresh = !visual;
      if (!visual) {
        visual = makeVisual(placement); visuals.set(id, visual);
        setPose(visual.group, animate ? sourcePoses.get(id) ?? { ...DECK, y: .25 } : adjusted(placement));
      }
      const old = visual.placement; visual.placement = placement;
      const hit: StageHit = placement.cardId ? { kind: placement.zone === "hand" ? "hand" : "card", cardId: placement.cardId, zone: placement.zone, ...(placement.seatId ? { seatId: placement.seatId } : {}) } : { kind: "zone", zone: placement.zone, ...(placement.seatId ? { seatId: placement.seatId } : {}) };
      visual.group.userData.hit = hit;
      if (pending?.cardId === id || drag?.cardId === id) continue;
      const material = face(placement); const faceChanged = material.key !== visual.faceKey;
      visual.front.material = material.material; visual.faceKey = material.key;
      const to = adjusted(placement), moving = motions.get(visual.group);
      if (fresh || !poseEquals(moving?.to ?? copyPose(visual.group), to) || old.zone !== placement.zone || faceChanged && old.card === null && placement.card !== null) {
        const handAdjustment = !fresh && old.zone === "hand" && placement.zone === "hand";
        const revealInPlace = !fresh && old.zone === "ante" && placement.zone === "ante" && faceChanged;
        move(visual.group, to, animate, handAdjustment || revealInPlace ? 0 : placement.zone === "hand" ? .45 : 1.2,
          animate && placement.card !== null && (fresh && placement.zone !== "hand" || faceChanged && old.card === null), undefined, handAdjustment ? 170 : 470);
      }
    }
    const used = new Set([...visuals.values(), ...(revealCue?.cards ?? [])].map(v => v.faceKey));
    for (const [id, material] of faces) if (!used.has(id)) { if (material.map) { material.map.dispose(); textures.delete(material.map); } material.dispose(); materials.delete(material); faces.delete(id); }
    rebuildZones(); refreshInfo(); presentationVisibility(); requestFrame();
  }
  function clearInteraction() { drag = null; pending = null; dragLine.visible = landing.visible = false; }
  function clearGestures() { for (const entry of gestureValues.values()) clearTimeout(entry.timer); gestureValues.clear(); }
  function resize() {
    if (destroyed) return; const rect = canvas.getBoundingClientRect(); width = Math.floor(rect.width); height = Math.floor(rect.height);
    if (width <= 0 || height <= 0) { if (raf) cancelAnimationFrame(raf); raf = 0; return; }
    renderer.setSize(width, height, false); const aspect = width / height, half = Math.max(7.5, 10.3 / aspect);
    camera.left = -half * aspect; camera.right = half * aspect; camera.top = half * (aspect < 1 ? .8 : 1); camera.bottom = -half * (aspect < 1 ? 1.2 : 1); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    // The local hand is a real mesh foreground fan, sized in projected pixels;
    // it remains usable on portrait screens instead of shrinking with the table.
    for (const visual of visuals.values()) if (visual.placement.zone === "hand" && visual.placement.card && visual.placement.key !== drag?.cardId && visual.placement.key !== pending?.cardId) { motions.delete(visual.group); setPose(visual.group, adjusted(visual.placement)); }
    requestFrame();
  }
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  const visibility = () => { if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; clearReveal(); finishMotions(); clearInteraction(); clearGestures(); } else { reconcile(false); resize(); } };
  const lost = (event: Event) => { event.preventDefault(); contextLost = true; if (raf) cancelAnimationFrame(raf); raf = 0; clearReveal(); finishMotions(); clearInteraction(); options.onQuality?.({ webgl: false, quality: "unavailable", reason: "context-lost" }); };
  const restored = () => { if (destroyed) return; contextLost = false; options.onQuality?.({ webgl: true, quality: "high" }); resize(); reconcile(false); };
  document.addEventListener("visibilitychange", visibility); canvas.addEventListener("webglcontextlost", lost); canvas.addEventListener("webglcontextrestored", restored);
  const setRay = (x: number, y: number) => { const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height || x < rect.left || y < rect.top || x > rect.right || y > rect.bottom) return false;
    pointer.set((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1); camera.updateMatrixWorld(); scene.updateMatrixWorld(true); ray.setFromCamera(pointer, camera); return true; };
  function anchor(query: StageAnchorQuery) {
    let target: THREE.Object3D | undefined;
    const visual = query.cardId ? revealCue?.cards.find(value => value.group.visible && value.placement.cardId === query.cardId) ?? visuals.get(query.cardId) : undefined;
    if (query.cardId) target = visual?.group;
    else if (query.zone === "stakes" && !query.seatId) target = stakesAnchor;
    else target = zoneGroup.children.find(child => { const hit = child.userData.hit as StageHit | undefined; return !!hit && hit.zone === query.zone && hit.seatId === query.seatId; });
    if (!target || destroyed) return null; scene.updateMatrixWorld(true); camera.updateMatrixWorld();
    // Anchor a fanned hand at its exposed strength corner, not at a center that
    // the next physical card can cover. Every card remains an actual ray target.
    const point = visual?.placement.zone === "hand" ? target.localToWorld(new THREE.Vector3(-W * .34, .03, -H * .34)) : target.getWorldPosition(new THREE.Vector3());
    const projected = point.project(camera), rect = canvas.getBoundingClientRect();
    return { x: rect.left + (projected.x + 1) * rect.width / 2, y: rect.top + (1 - projected.y) * rect.height / 2, visible: Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && projected.z >= -1 && projected.z <= 1 };
  }
  resize(); reconcile(false); options.onQuality?.({ webgl: true, quality: "high" });
  const handle: StageHandle = {
    update(next) {
      if (destroyed) return; const before = model.view;
      const oldSelf = before && "selfSeatId" in before ? before.selfSeatId : null;
      const nextSelf = next.view && "selfSeatId" in next.view ? next.view.selfSeatId : null;
      const reset = !before || !next.view || before.id !== next.view.id || oldSelf !== nextSelf || next.view.revision < before.revision || next.animate === false || next.connected === false;
      const animate = !reset && next.view!.revision >= before!.revision && next.view!.revision <= before!.revision + 1;
      if (reset || !animate) { clearReveal(); clearInteraction(); clearGestures(); finishMotions(); }
      else if (before?.revision !== next.view?.revision) clearGestures();
      if (next.reducedMotion) { clearReveal(); finishMotions(); }
      const reveal = animate && !next.reducedMotion && next.view!.revision === before!.revision + 1 ? prepareReveal(before!, next.view!) : null;
      model = next; previousView = before;
      if (reveal && !hidden()) { if (revealCue) { if (revealQueue.length < 4) revealQueue.push(reveal); } else startReveal(reveal); }
      reconcile(animate);
      if (!reveal && animate && next.view!.revision !== before!.revision) {
        if (revealCue) { if (deferredMoney.length < 8) deferredMoney.push({ before: before!, after: next.view! }); }
        else animateMoney(previousView);
      }
    },
    hitTest(x, y) {
      if (destroyed || hidden() || !setRay(x, y)) return null;
      // Inspecting is independent of action permission and pending ACKs. The
      // actively dragged mesh alone is omitted so it cannot cover a drop slot.
      const targets = [...visuals.values(), ...(revealCue?.cards ?? [])].filter(v => v.group.visible && v.placement.key !== drag?.cardId);
      const byGroup = new Map(targets.map(visual => [visual.group, visual]));
      const intersections = ray.intersectObjects(targets.map(v => v.group).concat([zoneGroup]), true);
      for (const hit of intersections) {
        let object: THREE.Object3D | null = hit.object;
        let visual: Visual | undefined, visible = true;
        // Decorative outline lines have a generous raycast tolerance. They
        // must not inherit the region's hit and occlude a nearby card face.
        const zone = hit.object.userData.hit as StageHit | undefined;
        while (object) {
          if (!object.visible) { visible = false; break; }
          visual ??= byGroup.get(object as THREE.Group);
          object = object.parent;
        }
        if (!visible) continue;
        if (visual) {
          // Glow/border planes are not card surfaces or invisible drop targets.
          if (hit.object !== visual.front && hit.object !== visual.body && hit.object !== visual.back) continue;
          const placement = visual.placement, seatId = placement.seatId ? { seatId: placement.seatId } : {};
          const ownAnte = model.view && "selfSeatId" in model.view && placement.seatId === model.view.selfSeatId && placement.cardId === (model.view as SeatView).committedAnte?.id;
          if (placement.cardId && (hit.object === visual.front && visual.faceKey !== "back" || ownAnte))
            return { kind: placement.zone === "hand" ? "hand" : "card", cardId: placement.cardId, zone: placement.zone, ...seatId };
          return { kind: "zone", zone: placement.zone, ...seatId };
        }
        if (zone) return { ...zone };
      }
      return null;
    },
    getAnchor: anchor,
    setDrag(value) {
      if (destroyed) return;
      if (!value) { const had = !!drag; drag = null; dragLine.visible = landing.visible = false; if (had) reconcile(true); return; }
      if (pending || model.connected === false || !model.view || !("selfSeatId" in model.view)) return;
      const visual = visuals.get(value.cardId); if (!visual || visual.placement.zone !== "hand" || visual.placement.seatId !== (model.view as SeatView).selfSeatId || !setRay(value.x, value.y)) return;
      if (!drag) { const center = visual.group.position.clone().project(camera), rect = canvas.getBoundingClientRect(); drag = { cardId: value.cardId, origin: copyPose(visual.group), offsetX: rect.left + (center.x + 1) * rect.width / 2 - value.x, offsetY: rect.top + (1 - center.y) * rect.height / 2 - value.y }; } if (drag.cardId !== value.cardId) return;
      if (!setRay(value.x + drag.offsetX, value.y + drag.offsetY)) return;
      const normal = camera.getWorldDirection(new THREE.Vector3());
      const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(drag.origin.x, drag.origin.y, drag.origin.z).addScaledVector(normal, -.35));
      const point = ray.ray.intersectPlane(dragPlane, new THREE.Vector3()); if (!point) return;
      motions.delete(visual.group); visual.group.position.copy(point); visual.group.rotation.set(Math.PI / 2 + camera.rotation.x, 0, 0, "YXZ"); visual.group.scale.setScalar(drag.origin.scale);
      const origin = new THREE.Vector3(drag.origin.x, drag.origin.y, drag.origin.z), end = visual.group.position;
      const curve = new THREE.QuadraticBezierCurve3(origin, origin.clone().lerp(end, .5).add(new THREE.Vector3(0, 1.6, 0)), end);
      const attribute = dragLineGeo.getAttribute("position"); curve.getPoints(24).forEach((p, i) => attribute.setXYZ(i, p.x, p.y, p.z)); attribute.needsUpdate = true; dragLineGeo.computeBoundingSphere(); dragLine.visible = true;
       const seat = seatPlacements(model.view).find(s => s.self), hit = handle.hitTest(value.x, value.y);
       const legal = model.legalDropZone;
       landing.visible = !!seat && !!legal && hit?.seatId === seat.id && hit.zone === legal;
       if (landing.visible && seat && legal) landing.position.set(seat[legal].x, .055, seat[legal].z);
       requestFrame();
    },
    releaseDrag(value = {}) {
      if (!drag || destroyed) return; const id = drag.cardId;
      if (value.pending && model.view) { pending = { cardId: id, gameId: model.view.id }; const visual = visuals.get(id); const seat = seatPlacements(model.view).find(s => s.self);
        if (visual && seat && value.zone) move(visual.group, { ...seat[value.zone], y: 1.05, tilt: .14, scale: 1.12 }, true, .6); }
      drag = null; dragLine.visible = landing.visible = false; if (!pending) reconcile(true); else rebuildZones(); requestFrame();
    },
    resolvePending(_accepted) { if (destroyed || !pending) return; pending = null; reconcile(true); },
    gesture(seatId, value) {
      if (destroyed || !model.view) return; const old = gestureValues.get(seatId);
      if (value === null) { if (old) clearTimeout(old.timer); gestureValues.delete(seatId); reconcile(true); return; }
      const valid = readHandGesture(value), seat = model.view.seats.find(s => s.id === seatId);
      if (!valid || !seat || valid.gameId !== model.view.id || valid.revision !== model.view.revision || valid.count !== seat.handCount || old && valid.sequence <= old.value.sequence || "selfSeatId" in model.view && model.view.selfSeatId === seatId) return;
      if (old) clearTimeout(old.timer); const timer = setTimeout(() => { gestureValues.delete(seatId); if (!destroyed) reconcile(true); }, 30000);
      gestureValues.set(seatId, { value: valid, expires: Date.now() + 30000, timer }); reconcile(true);
    },
    suspend() { if (destroyed) return; explicitSuspend = true; if (raf) cancelAnimationFrame(raf); raf = 0; clearReveal(); clearInteraction(); clearGestures(); finishMotions(); },
    resume() { if (destroyed) return; explicitSuspend = false; reconcile(false); resize(); },
    destroy() {
      if (destroyed) return; destroyed = true; if (raf) cancelAnimationFrame(raf); raf = 0; clearReveal(); motions.clear(); clearInteraction(); clearGestures(); observer.disconnect();
      document.removeEventListener("visibilitychange", visibility); canvas.removeEventListener("webglcontextlost", lost); canvas.removeEventListener("webglcontextrestored", restored);
      scene.traverse(object => { if ((object as THREE.InstancedMesh).isInstancedMesh) (object as THREE.InstancedMesh).dispose(); });
      for (const item of textures) item.dispose(); for (const item of materials) item.dispose(); for (const item of geometries) item.dispose();
      textures.clear(); materials.clear(); geometries.clear(); faces.clear(); visuals.clear(); scene.clear(); renderer.renderLists.dispose(); renderer.dispose(); renderer.forceContextLoss();
    },
    diagnostics() { let meshes = 0; scene.traverse(object => { if ((object as THREE.Mesh).isMesh) meshes++; }); return { frames, animations: motions.size + (revealCue ? 1 : 0), meshes, textures: textures.size, drawCalls: renderer.info.render.calls, suspended: hidden(), destroyed, pendingCardId: pending?.cardId ?? null, faceCardIds: [...visuals.values(), ...(revealCue?.cards ?? [])].filter(v => v.group.visible && v.faceKey !== "back").map(v => v.placement.cardId!).filter(Boolean) }; },
  };
  return handle;
}
