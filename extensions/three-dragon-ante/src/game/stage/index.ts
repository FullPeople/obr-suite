import * as THREE from "three";
import { readHandGesture, type HandGesture } from "../gesture";
import type { SeatView } from "../rules/types";
import { cardTexture, labelTexture, woodTexture, feltTexture } from "./textures";
import { placements, seatPlacements, coinDenominations, DECK, DISCARD, STAKES, pileTop, type Pose, type CardPlacement } from "./layout";
import type { StageAnchorQuery, StageHandle, StageHit, StageModel, StageOptions, StageZone } from "./types";
export type * from "./types";

interface Visual { group: THREE.Group; front: THREE.Mesh; faceKey: string; placement: CardPlacement }
interface Motion { object: THREE.Object3D; start: number; duration: number; from: Pose; to: Pose; arc: number; flip: boolean; done?: () => void }
const W = 1.28, H = 1.85, THICKNESS = .045;
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
  const zoneGroup = new THREE.Group(), infoGroup = new THREE.Group(), moneyGroup = new THREE.Group(), stackGroup = new THREE.Group(); scene.add(zoneGroup, infoGroup, moneyGroup, stackGroup);
  const zoneGeo = geo(new THREE.PlaneGeometry(W * 1.18, H * 1.1));
  const labelGeo = geo(new THREE.PlaneGeometry(1, 160 / 768));
  const zoneBorderGeo = geo(new THREE.EdgesGeometry(zoneGeo));
  const zoneBorderMat = mat(new THREE.LineBasicMaterial({ color: "#b3965d", transparent: true, opacity: .3 }));
  const zoneMaterial = standard("#ad8b55", { transparent: true, opacity: .06, depthWrite: false });
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
    for (const [object, motion] of motions) {
      const t = Math.max(0, Math.min(1, (now - motion.start) / motion.duration));
      const ease = t * t * (3 - 2 * t), p = motion.from, q = motion.to;
      const bounce = t > .82 ? Math.sin((t - .82) / .18 * Math.PI) * .035 : 0;
      setPose(object, { x: THREE.MathUtils.lerp(p.x, q.x, ease), y: THREE.MathUtils.lerp(p.y, q.y, ease) + Math.sin(Math.PI * t) * motion.arc + bounce,
        z: THREE.MathUtils.lerp(p.z, q.z, ease), yaw: THREE.MathUtils.lerp(p.yaw, q.yaw, ease), tilt: THREE.MathUtils.lerp(p.tilt, q.tilt, ease),
        roll: THREE.MathUtils.lerp(p.roll ?? 0, q.roll ?? 0, ease) + (motion.flip ? Math.PI * (1 - ease) : 0), scale: THREE.MathUtils.lerp(p.scale, q.scale, ease) });
      if (t >= 1) { setPose(object, q); motions.delete(object); motion.done?.(); }
    }
    renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); frames++;
    if (motions.size) requestFrame();
  }
  function move(object: THREE.Object3D, to: Pose, animate: boolean, arc = .7, flip = false, done?: () => void) {
    if (!animate || model.reducedMotion || hidden()) { motions.delete(object); setPose(object, to); done?.(); return; }
    motions.set(object, { object, from: copyPose(object), to, start: performance.now(), duration: 470, arc, flip, done });
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
  function rebuildZones() {
    const view = model.view, signature = JSON.stringify([view?.id, view?.seats.map(s => s.id), view && "selfSeatId" in view ? view.selfSeatId : null, model.language]);
    if (signature === zoneSignature) return; zoneSignature = signature; freeOwnedGroup(zoneGroup);
    const zone = (kind: StageZone, pose: Pose, seatId?: string) => {
      const object = mesh(zoneGeo, zoneMaterial, zoneGroup); object.rotation.x = -Math.PI / 2; object.rotation.z = -pose.yaw; object.position.set(pose.x, .027, pose.z);
      object.userData.hit = { kind: "zone", zone: kind, ...(seatId ? { seatId } : {}) } satisfies StageHit;
      const border = new THREE.LineSegments(zoneBorderGeo, zoneBorderMat);
      object.add(border);
      if (kind !== "stakes") label(zoneGroup, model.language === "zh" ? ({ ante: "暗置牌", flight: "航线", deck: "牌库", discard: "弃牌", hand: "手牌" }[kind]) : kind.toUpperCase(), new THREE.Vector3(pose.x, .035, pose.z + 1.08), 1.35, true);
    };
    zone("deck", DECK); zone("discard", DISCARD); zone("stakes", { ...DECK, ...STAKES });
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
  function animateMoney(before: StageModel["view"]) {
    const view = model.view; if (!view || !before || model.reducedMotion) return;
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
        const object = mesh(coinGeo, goldMat, moneyGroup); object.castShadow = true; const from = moneyLocation(source[0]), to = moneyLocation(target[0]);
        object.position.copy(from).add(new THREE.Vector3(i * .08, .35, 0));
        move(object, { x: to.x + i * .06, y: .35, z: to.z, yaw: i * .7, tilt: 0, scale: 1 }, true, 1.5 + i * .08, false, () => { moneyGroup.remove(object); });
      }
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
    for (const [id, visual] of visuals) if (!desired.has(id) && pending?.cardId !== id && drag?.cardId !== id) { motions.delete(visual.group); scene.remove(visual.group); visuals.delete(id); }
    for (const [id, placement] of desired) {
      let visual = visuals.get(id); const fresh = !visual;
      if (!visual) {
        const group = new THREE.Group(); scene.add(group); const body = mesh(cardBody, edgeMat, group); body.castShadow = true; body.receiveShadow = true;
        const front = mesh(cardPlane, backMat, group); front.rotation.x = -Math.PI / 2; front.position.y = THICKNESS / 2 + .001; front.receiveShadow = true;
        const back = mesh(cardPlane, backMat, group); back.rotation.x = Math.PI / 2; back.position.y = -THICKNESS / 2 - .001;
        visual = { group, front, faceKey: "back", placement }; visuals.set(id, visual);
        setPose(group, animate ? { ...DECK, y: .25 } : adjusted(placement));
        // An opponent's newly public flight starts at that player's face-down
        // hand region, without assigning an identity to any prior hidden back.
        if (animate && placement.zone === "flight" && placement.seatId) { const seat = model.view && seatPlacements(model.view).find(s => s.id === placement.seatId); if (seat) setPose(group, { ...placement.pose, x: seat.x, z: seat.z, y: .35 }); }
      }
      const old = visual.placement; visual.placement = placement;
      const hit: StageHit = placement.cardId ? { kind: placement.zone === "hand" ? "hand" : "card", cardId: placement.cardId, zone: placement.zone, ...(placement.seatId ? { seatId: placement.seatId } : {}) } : { kind: "zone", zone: placement.zone, ...(placement.seatId ? { seatId: placement.seatId } : {}) };
      visual.group.userData.hit = hit;
      if (pending?.cardId === id || drag?.cardId === id) continue;
      const material = face(placement); const faceChanged = material.key !== visual.faceKey;
      visual.front.material = material.material; visual.faceKey = material.key;
      const to = adjusted(placement), moving = motions.get(visual.group);
      if (fresh || !poseEquals(moving?.to ?? copyPose(visual.group), to) || old.zone !== placement.zone) {
        move(visual.group, to, animate, placement.zone === "hand" ? .45 : 1.2, animate && placement.card !== null && (fresh && placement.zone !== "hand" || faceChanged && old.card === null));
      }
    }
    const used = new Set([...visuals.values()].map(v => v.faceKey));
    for (const [id, material] of faces) if (!used.has(id)) { if (material.map) { material.map.dispose(); textures.delete(material.map); } material.dispose(); materials.delete(material); faces.delete(id); }
    rebuildZones(); refreshInfo(); requestFrame();
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
  const visibility = () => { if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; finishMotions(); clearInteraction(); clearGestures(); } else { reconcile(false); resize(); } };
  const lost = (event: Event) => { event.preventDefault(); contextLost = true; if (raf) cancelAnimationFrame(raf); raf = 0; finishMotions(); clearInteraction(); options.onQuality?.({ webgl: false, quality: "unavailable", reason: "context-lost" }); };
  const restored = () => { if (destroyed) return; contextLost = false; options.onQuality?.({ webgl: true, quality: "high" }); resize(); reconcile(false); };
  document.addEventListener("visibilitychange", visibility); canvas.addEventListener("webglcontextlost", lost); canvas.addEventListener("webglcontextrestored", restored);
  const setRay = (x: number, y: number) => { const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height || x < rect.left || y < rect.top || x > rect.right || y > rect.bottom) return false;
    pointer.set((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1); camera.updateMatrixWorld(); scene.updateMatrixWorld(true); ray.setFromCamera(pointer, camera); return true; };
  function anchor(query: StageAnchorQuery) {
    let target: THREE.Object3D | undefined;
    if (query.cardId) target = visuals.get(query.cardId)?.group;
    else target = zoneGroup.children.find(child => { const hit = child.userData.hit as StageHit | undefined; return !!hit && hit.zone === query.zone && hit.seatId === query.seatId; });
    if (!target || destroyed) return null; scene.updateMatrixWorld(true); camera.updateMatrixWorld();
    // Anchor a fanned hand at its exposed strength corner, not at a center that
    // the next physical card can cover. Every card remains an actual ray target.
    const visual = query.cardId ? visuals.get(query.cardId) : undefined;
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
      if (reset) { clearInteraction(); clearGestures(); finishMotions(); }
      else if (before?.revision !== next.view?.revision) clearGestures();
      if (next.reducedMotion) finishMotions();
      model = next; previousView = before; reconcile(animate);
      if (animate && next.view!.revision !== before!.revision) animateMoney(previousView);
    },
    hitTest(x, y) {
      if (destroyed || hidden() || !setRay(x, y)) return null;
      const intersections = ray.intersectObjects([...visuals.values()].filter(v => v.placement.key !== drag?.cardId && v.placement.key !== pending?.cardId).map(v => v.group).concat([zoneGroup]), true);
      for (const hit of intersections) { let object: THREE.Object3D | null = hit.object; while (object) { if (object.userData.hit) return { ...object.userData.hit } as StageHit; object = object.parent; } }
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
      const seat = seatPlacements(model.view).find(s => s.self)!; const closest = [seat.ante, seat.flight].sort((a, b) => Math.hypot(a.x - point.x, a.z - point.z) - Math.hypot(b.x - point.x, b.z - point.z))[0];
      landing.position.set(closest.x, .055, closest.z); landing.visible = true; requestFrame();
    },
    releaseDrag(value = {}) {
      if (!drag || destroyed) return; const id = drag.cardId;
      if (value.pending && model.view) { pending = { cardId: id, gameId: model.view.id }; const visual = visuals.get(id); const seat = seatPlacements(model.view).find(s => s.self);
        if (visual && seat && value.zone) move(visual.group, { ...seat[value.zone], y: 1.05, tilt: .14, scale: 1.12 }, true, .6); }
      drag = null; dragLine.visible = landing.visible = false; if (!pending) reconcile(true); requestFrame();
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
    suspend() { if (destroyed) return; explicitSuspend = true; if (raf) cancelAnimationFrame(raf); raf = 0; clearInteraction(); clearGestures(); finishMotions(); },
    resume() { if (destroyed) return; explicitSuspend = false; reconcile(false); resize(); },
    destroy() {
      if (destroyed) return; destroyed = true; if (raf) cancelAnimationFrame(raf); raf = 0; motions.clear(); clearInteraction(); clearGestures(); observer.disconnect();
      document.removeEventListener("visibilitychange", visibility); canvas.removeEventListener("webglcontextlost", lost); canvas.removeEventListener("webglcontextrestored", restored);
      scene.traverse(object => { if ((object as THREE.InstancedMesh).isInstancedMesh) (object as THREE.InstancedMesh).dispose(); });
      for (const item of textures) item.dispose(); for (const item of materials) item.dispose(); for (const item of geometries) item.dispose();
      textures.clear(); materials.clear(); geometries.clear(); faces.clear(); visuals.clear(); scene.clear(); renderer.renderLists.dispose(); renderer.dispose(); renderer.forceContextLoss();
    },
    diagnostics() { let meshes = 0; scene.traverse(object => { if ((object as THREE.Mesh).isMesh) meshes++; }); return { frames, animations: motions.size, meshes, textures: textures.size, drawCalls: renderer.info.render.calls, suspended: hidden(), destroyed, pendingCardId: pending?.cardId ?? null, faceCardIds: [...visuals.values()].filter(v => v.faceKey !== "back").map(v => v.placement.cardId!).filter(Boolean) }; },
  };
  return handle;
}
