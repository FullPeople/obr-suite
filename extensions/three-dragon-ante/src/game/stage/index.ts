import * as THREE from "three";
import {currencyGeometry,currencyTexture} from "./currency";
import { readHandGesture, type HandGesture } from "../gesture";
import type { OmniscientView, PublicEvent, SeatView } from "../rules/types";
import { card } from "../rules/cards";
import { powerEffectTheme, type PowerEffectShape } from "../power-effects";
import { abilityClass, classEffect, type ClassGlyph } from "../power-classes";
import type { PowerTargetRelation } from "../power-sequence";
import { publicFlightFormation, type PublicFlightFormationKind } from "../flight-formations";
import { cardTexture, labelTexture, woodTexture, feltTexture, zoneLabelTexture, badgeTexture, beamTexture } from "./textures";
import { placements, seatPlacements, coinDenominations, moneyPlacement, tableShape, TABLE, ZONE_DEPTH, SELF_STRIP_DEPTH, DECK, DISCARD, STAKES, HOLE, pileTop, type Pose, type CardPlacement, type SeatStripZone } from "./layout";
import type { StageAnchorQuery, StageDiagnostics, StageGoldFlow, StageHandle, StageHit, StageModel, StageOptions, StageQuality, StageQualityLevel, StageQualityMode, StageZone } from "./types";
import { REVEAL_PRESENTATION_MS, type RevealPhase } from "./types";
export type * from "./types";

interface Visual { group: THREE.Group; body: THREE.Mesh; front: THREE.Mesh; back: THREE.Mesh; effectGlow: THREE.Mesh; powerOutline: THREE.Mesh; faceKey: string; placement: CardPlacement }
interface Motion { object: THREE.Object3D; start: number; duration: number; from: Pose; to: Pose; arc: number; flip: boolean; bounce: boolean; done?: () => void }
interface RevealData { gameId: string; gambit: number; cards: { placement: CardPlacement; from: Pose }[]; allTied: boolean; payments: { seatId: string; amount: number }[] }
interface RevealCue { data: RevealData; start: number; cards: Visual[]; labels: THREE.Mesh[]; highlights: THREE.Mesh[]; flipped: boolean; paid: boolean }
interface PowerPulse { object: THREE.Mesh; material: THREE.MeshBasicMaterial; start: number }
interface PowerBurst {
  group: THREE.Group;
  source: Visual;
  formation: THREE.Group;
  formationMaterial: THREE.MeshBasicMaterial;
  smokeMaterial: THREE.SpriteMaterial;
  themeKey: string;
  shape: PowerEffectShape;
  rotation: number;
  smokeBaseOpacity: number;
  puffs: { object: THREE.Sprite; angle: number; distance: number; rise: number; size: number; spin: number }[];
  start: number;
}
interface FlightFormation { seatId: string; kind: PublicFlightFormationKind }
const H = 1.85, W = H * 1250 / 2208, THICKNESS = .045;
const last = <T>(values: readonly T[]): T | undefined => values[values.length - 1];
const copyPose = (object: THREE.Object3D): Pose => ({ x: object.position.x, y: object.position.y, z: object.position.z, yaw: object.rotation.y, tilt: object.rotation.x, roll: object.rotation.z, scale: object.scale.x });
const setPose = (object: THREE.Object3D, pose: Pose) => { object.position.set(pose.x, pose.y, pose.z); object.rotation.set(pose.tilt, pose.yaw, pose.roll ?? 0, "YXZ"); object.scale.setScalar(pose.scale); };
const poseEquals = (a: Pose, b: Pose) => ["x", "y", "z", "yaw", "tilt", "scale", "roll"].every(key => Math.abs(((a as any)[key] ?? 0) - ((b as any)[key] ?? 0)) < .00001);

/** A projections-only, event-driven Three.js surface. No game transport or input listeners. */
export function mountTableStage(canvas: HTMLCanvasElement, options: StageOptions = {}): StageHandle {
  let renderer: THREE.WebGLRenderer;
  // The shell's own wood-plank backdrop is the intended surround, so the canvas
  // stays transparent instead of painting a flat colour over it.
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" }); }
    catch { options.onQuality?.({ webgl: false, quality: "unavailable", reason: "creation-failed" });
    let dead = false; return { update() {}, setQuality() {}, settled: () => true, idle: () => true, hitTest: () => null, getAnchor: () => null, dragPoint: () => null, setBeamIntensity() {}, setDrag() {}, releaseDrag() {}, resolvePending() {}, gesture() {}, suspend() {}, resume() {}, destroy() { dead = true; }, diagnostics: () => ({ frames: 0, animations: 0, meshes: 0, textures: 0, drawCalls: 0, suspended: true, destroyed: dead, pendingCardId: null, faceCardIds: [], powerPulses: 0, powerBursts: 0, powerBurstThemes: [], powerBurstShapes: [], flightFormations: [], resolutionLinkVisible: false, resolutionTargetMarkerVisible: false, goldTransfers: 0, handPowerStates: [], handPowerOutlines: [], beamStates: [], spotlightSeatId: null, spotlightAnimating: false, slapStates: [], sceneJolt: { x: 0, y: 0, z: 0 }, strikeHandVisible: false, quality: "unavailable", qualityMode: options.quality ?? "auto", pixelRatio: 0, shadowsEnabled: false }) }; }
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.22;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75)); renderer.shadowMap.enabled = true;
  // Three 0.186 removed PCFSoftShadowMap; naming it only produced a console
  // warning before silently falling back to this same filter.
  renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-12, 12, 8, -8, .1, 80);
  camera.position.set(0, 17, 13.5); camera.lookAt(0, 0, .55);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  const geo = <T extends THREE.BufferGeometry>(value: T) => { geometries.add(value); return value; };
  const mat = <T extends THREE.Material>(value: T) => { materials.add(value); return value; };
  const tex = <T extends THREE.Texture>(value: T) => { textures.add(value); return value; };
  const standard = (color: THREE.ColorRepresentation, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => mat(new THREE.MeshStandardMaterial({ color, roughness: .78, ...extra }));
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material|THREE.Material[], parent: THREE.Object3D = scene) => { const result = new THREE.Mesh(geometry, material); parent.add(result); return result; };
  const wood = tex(woodTexture()); const woodMat = standard("#947b65", { map: wood, roughness:.38 });
  const feltMat = standard("#153a32", { map: tex(feltTexture()), roughness:1 });
  const apronMat = standard("#211612", { map:wood, roughness:.48 });
  const trimMat = standard("#8f7950", { metalness:.58, roughness:.5 });
  const railMat = standard("#251b17", { roughness:.72 });
  /** Closed rounded-rectangle outline, used by the square table parts and by
   *  every per-zone plate. */
  const roundedRect = (halfX: number, halfZ: number, corner: number) => {
    const shape = new THREE.Shape(), r = Math.max(0, Math.min(corner, halfX, halfZ));
    shape.moveTo(-halfX + r, -halfZ);
    shape.lineTo(halfX - r, -halfZ); shape.quadraticCurveTo(halfX, -halfZ, halfX, -halfZ + r);
    shape.lineTo(halfX, halfZ - r); shape.quadraticCurveTo(halfX, halfZ, halfX - r, halfZ);
    shape.lineTo(-halfX + r, halfZ); shape.quadraticCurveTo(-halfX, halfZ, -halfX, halfZ - r);
    shape.lineTo(-halfX, -halfZ + r); shape.quadraticCurveTo(-halfX, -halfZ, -halfX + r, -halfZ);
    return shape;
  };
  const slab = (shape: THREE.Shape, depth: number, bevel = 0) => geo(new THREE.ExtrudeGeometry(shape, bevel > 0
    ? { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel * .7, bevelSegments: 2, curveSegments: 24 }
    : { depth, bevelEnabled: false, curveSegments: 24 }));
  /** A flat plate laid on the felt. Extrusion runs along local +Z, which the
   *  rotation maps to world +Y, so the top face lands exactly on `height`. */
  const plate = (parent: THREE.Object3D, shape: THREE.Shape, depth: number, top: number, material: THREE.Material) => {
    const object = mesh(slab(shape, depth), material, parent);
    object.rotation.x = -Math.PI / 2; object.position.y = top - depth; return object;
  };
  const ringPath = (shape: THREE.Shape, radius: number) => geo(new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(shape.getPoints(96).map(point => new THREE.Vector3(point.x, 0, -point.y)), true), 96, radius, 6, true));
  // Two complete tables. Two and three players keep the round top; four or more
  // use the rounded square. Both are built once and toggled, so a joining player
  // never has to rebuild table geometry during a game.
  const roundTable = new THREE.Group(), squareTable = new THREE.Group();
  roundTable.name = "table-round"; squareTable.name = "table-square"; squareTable.visible = false;
  scene.add(roundTable, squareTable);
  const squareHalf = TABLE.square.half, squareCorner = TABLE.square.corner, woodHalf = squareHalf + .97;
  const roundProfile=[[0,-.62],[8.45,-.62],[8.67,-.53],[8.82,-.29],[8.9,-.12],[8.86,-.02],[8.7,.015],[0,.015]].map(([x,y])=>new THREE.Vector2(x,y));
  const table=mesh(geo(new THREE.LatheGeometry(roundProfile,96)),woodMat,roundTable);table.receiveShadow=true;table.castShadow=true;
  const apron=mesh(geo(new THREE.CylinderGeometry(8.46,8.34,.5,96)),apronMat,roundTable);apron.position.y=-.79;apron.castShadow=true;
  const felt=mesh(geo(new THREE.CylinderGeometry(TABLE.round.feltRadius,TABLE.round.feltRadius,.022,96)),feltMat,roundTable);felt.position.y=.027;felt.receiveShadow=true;
  for(const [radius,y,thickness] of [[7.99,.033,.022],[8.56,.025,.017],[8.83,-.19,.025]]){
    const trim=mesh(geo(new THREE.TorusGeometry(radius,thickness,6,96)),trimMat,roundTable);trim.rotation.x=-Math.PI/2;trim.position.y=y;
  }
  const rail=mesh(geo(new THREE.TorusGeometry(TABLE.round.railRadius,.16,12,96)),railMat,roundTable);rail.rotation.x=-Math.PI/2;rail.position.y=.035;rail.receiveShadow=true;
  const squareTop = plate(squareTable, roundedRect(woodHalf, woodHalf, squareCorner + .97), .635, .015, woodMat);
  squareTop.receiveShadow = true; squareTop.castShadow = true;
  const squareApron = plate(squareTable, roundedRect(squareHalf + .53, squareHalf + .53, squareCorner), .5, -.54, apronMat);
  squareApron.castShadow = true;
  plate(squareTable, roundedRect(squareHalf, squareHalf, squareCorner), .022, .038, feltMat).receiveShadow = true;
  for (const [inset, y, thickness] of [[.06,.033,.022],[.63,.025,.017],[.9,-.19,.025]]) {
    const trim = mesh(ringPath(roundedRect(squareHalf + inset, squareHalf + inset, squareCorner + inset), thickness), trimMat, squareTable); trim.position.y = y;
  }
  const squareRail = mesh(ringPath(roundedRect(squareHalf + .37, squareHalf + .37, squareCorner + .37), .16), railMat, squareTable);
  squareRail.position.y = .035; squareRail.receiveShadow = true;
  const syncTableShape = () => {
    const square = tableShape(model.view?.seats.length ?? 2) === "square";
    if (roundTable.visible !== !square) { roundTable.visible = !square; squareTable.visible = square; requestFrame(); }
  };
  // A shadow catcher, not a backdrop: ShadowMaterial paints only the received
  // shadow, so the table keeps its grounding while the shell's wood planks show
  // through the transparent canvas around it.
  const floor=mesh(geo(new THREE.PlaneGeometry(70,70)),new THREE.ShadowMaterial({opacity:.5}));floor.rotation.x=-Math.PI/2;floor.position.y=-2.8;floor.receiveShadow=true;
  const pedestal=mesh(geo(new THREE.CylinderGeometry(2.3,3.1,2,32)),woodMat);pedestal.position.y=-1.8;pedestal.castShadow=true;
  const ambient = new THREE.HemisphereLight("#ffe5b7", "#252b29", 1.22); scene.add(ambient);
  const key = new THREE.DirectionalLight("#ffeacb", 2.3); key.position.set(-5, 11, 6); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -12; key.shadow.camera.right = 12; key.shadow.camera.top = 11; key.shadow.camera.bottom = -11; key.shadow.normalBias = .025; key.shadow.bias = -.0003; key.shadow.intensity = .45; scene.add(key);
  const fill = new THREE.PointLight("#bdcbd7", 50, 35, 2); fill.position.set(6, 8, -5); scene.add(fill);
  // One light shaft per seat. Each stands on that seat's own ante area, its
  // apex is far above the visible table so the source itself is never on
  // screen, and it widens to cover the whole seat while that seat is acting.
  // The seats are fixed in number, so the meshes are allocated once and only
  // repositioned: nothing is created or thrown away when a projection changes.
  const BEAM_HEIGHT = 22, BEAM_BASE = 1.0, BEAM_HALO = 2.3, BEAM_AURA = 3.4, BEAM_LIFT = 1.95, FOCUS_MS = 520, MAX_SEATS = 6;
  const beamTex = tex(beamTexture());
  const beamGeo = geo(new THREE.ConeGeometry(BEAM_BASE, BEAM_HEIGHT, 56, 1, true));
  const beamHaloGeo = geo(new THREE.ConeGeometry(BEAM_HALO, BEAM_HEIGHT, 56, 1, true));
  const beamAuraGeo = geo(new THREE.ConeGeometry(BEAM_AURA, BEAM_HEIGHT, 56, 1, true));
  interface SeatBeam { group: THREE.Group; core: THREE.Mesh; halo: THREE.Mesh; aura: THREE.Mesh; from: { x: number; z: number }; to: { x: number; z: number }; focus: number; fromFocus: number; target: number; presence: number; fromPresence: number; targetPresence: number; start: number; seatId: string; committed: boolean }
  /** A light shaft material. The alpha follows how squarely each fragment faces
   *  the camera, so the shaft fades to nothing at its own silhouette instead of
   *  ending on a hard cone edge; the vertical gradient softens it along its
   *  length as well. Static: no time uniform, so it never needs a render loop. */
  const beamShaft = (color: string, opacity: number) => mat(new THREE.ShaderMaterial({
    uniforms: { uMap: { value: beamTex }, uColor: { value: new THREE.Color(color) }, uBase: { value: opacity }, uOpacity: { value: opacity } },
    vertexShader: "varying vec2 vUv; varying vec3 vNormalView; void main() { vUv = uv; vNormalView = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv; varying vec3 vNormalView; void main() { float facing = abs(normalize(vNormalView).z); float edge = smoothstep(0.0, 0.9, facing); float along = texture2D(uMap, vUv).a; gl_FragColor = vec4(uColor, uOpacity * along * edge); }",
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  }));
  const beams: SeatBeam[] = [];
  /** Local intensity multiplier for the seating light, fixed at the value the
   *  table was reviewed with. It never enters the projection or a room message;
   *  `setBeamIntensity` stays available to the regression harness. */
  let beamScale = .6;
  for (let index = 0; index < MAX_SEATS; index++) {
    const group = new THREE.Group(); group.visible = false; scene.add(group);
    const core = mesh(beamGeo, beamShaft("#ffffff", .078), group);
    const halo = mesh(beamHaloGeo, beamShaft("#f2f6ff", .030), group);
    const aura = mesh(beamAuraGeo, beamShaft("#ffffff", .012), group);
    for (const shaft of [core, halo, aura]) { shaft.position.y = BEAM_HEIGHT / 2; shaft.raycast = () => {}; shaft.renderOrder = 2; shaft.castShadow = false; shaft.receiveShadow = false; shaft.userData.noShadow = true; }
    beams.push({ group, core, halo, aura, from: { x: 0, z: 0 }, to: { x: 0, z: 0 }, focus: 0, fromFocus: 0, target: 0, presence: 0, fromPresence: 0, targetPresence: 0, start: 0, seatId: "", committed: false });
  }
  /** Places one shaft. `focus` 0 rests on the seat's ante area, 1 has grown and
   *  moved onto the whole seat. */
  function placeBeam(beam: SeatBeam, focus: number) {
    const scale = 1 + focus * BEAM_LIFT;
    const x = beam.from.x + (beam.to.x - beam.from.x) * focus, z = beam.from.z + (beam.to.z - beam.from.z) * focus;
    beam.group.position.set(x, 0, z); beam.group.scale.set(scale, 1, scale);
    const level = beam.presence;
    for (const shaft of [beam.core, beam.halo, beam.aura]) {
      const uniforms = (shaft.material as THREE.ShaderMaterial).uniforms;
      uniforms.uOpacity.value = uniforms.uBase.value * (1 + focus * .5) * level * beamScale;
    }
    beam.group.visible = level > .01;
  }
  const cardBody = geo(new THREE.BoxGeometry(W, THICKNESS, H));
  const cardPlane = geo(new THREE.PlaneGeometry(W, H));
  const edgeMat = standard("#4f473d", { roughness: .82 });
  const backMat = standard("#ffffff", { map: tex(cardTexture(null, "en")), roughness: .77 });
  const faces = new Map<string, THREE.MeshBasicMaterial>();
  const visuals = new Map<string, Visual>(), motions = new Map<THREE.Object3D, Motion>();
  const zoneGroup = new THREE.Group(), infoGroup = new THREE.Group(), moneyGroup = new THREE.Group(), stackGroup = new THREE.Group(), transferGroup = new THREE.Group(), revealGroup = new THREE.Group(), powerEffectsGroup = new THREE.Group(); scene.add(zoneGroup, infoGroup, moneyGroup, stackGroup, transferGroup, revealGroup, powerEffectsGroup);
  const stakesAnchor = new THREE.Object3D(); stakesAnchor.position.set(STAKES.x, STAKES.y, STAKES.z); scene.add(stakesAnchor);
  // The hole is a public, non-interactive pool. Keep its geometry quiet and
  // distinct from the warm stakes so debt repayment remains legible without
  // competing with cards or pretending to be another action zone.
  const holeAnchor = new THREE.Object3D(); holeAnchor.position.set(HOLE.x, .028, HOLE.z); scene.add(holeAnchor);
  const holeBasin = mesh(geo(new THREE.CylinderGeometry(.72, .78, .035, 40)), standard("#1b2630", { roughness: .92 }), holeAnchor); holeBasin.receiveShadow = true;
  const holeRim = mesh(geo(new THREE.TorusGeometry(.72, .045, 8, 40)), standard("#8d78a0", { metalness: .42, roughness: .58 }), holeAnchor); holeRim.rotation.x = -Math.PI / 2; holeRim.position.y = .026; holeRim.receiveShadow = true;
  const holeMark = mesh(geo(new THREE.RingGeometry(.25, .29, 6)), mat(new THREE.MeshBasicMaterial({ color: "#b99ac7", transparent: true, opacity: .44, depthWrite: false, toneMapped: false })), holeAnchor); holeMark.rotation.x = -Math.PI / 2; holeMark.position.y = .047; holeMark.renderOrder = 3;
  const labelGeo = geo(new THREE.PlaneGeometry(1, 160 / 768));
  const zoneBorderMat = mat(new THREE.LineBasicMaterial({ color: "#b3965d", transparent: true, opacity: .55 }));
  // Every seat zone is its own plate, built in world units so a rounded corner
  // stays a true quarter circle instead of being stretched sideways by a
  // non-uniform scale. Corners round only where the strip ends: the ante's
  // outer end and the flight's outer end.
  const plateCache = new Map<string, { mesh: THREE.BufferGeometry; outline: THREE.BufferGeometry }>();
  const plateGeo = (width: number, depth: number, roundStart: boolean, roundEnd: boolean) => {
    const key = `${width.toFixed(3)}|${depth.toFixed(3)}|${roundStart ? 1 : 0}${roundEnd ? 1 : 0}`;
    const cached = plateCache.get(key); if (cached) return cached;
    const halfX = width / 2, halfZ = depth / 2, r = Math.max(.001, Math.min(.3, halfX, halfZ));
    const shape = new THREE.Shape();
    if (roundStart) {
      shape.moveTo(-halfX + r, -halfZ); shape.lineTo(halfX, -halfZ); shape.lineTo(halfX, halfZ); shape.lineTo(-halfX + r, halfZ);
      shape.absarc(-halfX + r, halfZ - r, r, Math.PI / 2, Math.PI, false);
      shape.lineTo(-halfX, -halfZ + r);
      shape.absarc(-halfX + r, -halfZ + r, r, Math.PI, Math.PI * 1.5, false);
    } else if (roundEnd) {
      shape.moveTo(-halfX, -halfZ); shape.lineTo(halfX - r, -halfZ);
      shape.absarc(halfX - r, -halfZ + r, r, -Math.PI / 2, 0, false);
      shape.lineTo(halfX, halfZ - r);
      shape.absarc(halfX - r, halfZ - r, r, 0, Math.PI / 2, false);
      shape.lineTo(-halfX, halfZ); shape.lineTo(-halfX, -halfZ);
    } else {
      shape.moveTo(-halfX, -halfZ); shape.lineTo(halfX, -halfZ); shape.lineTo(halfX, halfZ); shape.lineTo(-halfX, halfZ); shape.lineTo(-halfX, -halfZ);
    }
    // The outline must live in the same local XY plane as the ShapeGeometry it
    // traces, otherwise the parent rotation stands it up as a vertical ribbon.
    const points = shape.getPoints(18).map(point => new THREE.Vector3(point.x, point.y, 0));
    const value = { mesh: geo(new THREE.ShapeGeometry(shape, 8)), outline: geo(new THREE.BufferGeometry().setFromPoints([...points, points[0].clone()])) };
    plateCache.set(key, value); return value;
  };
  const zoneLabelGeo = geo(new THREE.PlaneGeometry(1, 1));
  const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  const BADGE_SIZE = .41;
  const badgeGeo = geo(new THREE.PlaneGeometry(BADGE_SIZE, BADGE_SIZE));
  const badgeRingGeo = geo(new THREE.RingGeometry(.32, .345, 40));
  const seatColors=['#e2bd7c','#9ec9a9','#b6afd7','#98bfd8','#dfa997','#b8c985'];
  // Connection routes use a shared unit segment, transformed per owner.
  const zoneMaterial = standard("#ad8b55", { transparent: true, opacity: .14, depthWrite: false });
  // The three seat regions carry different fills so their boundaries are
  // readable without relying on thin divider lines: a cool face-down ante, a
  // warm coin tray, and a mossy public flight.
  const zoneFill = {
    ante: standard("#5f7f96", { transparent: true, opacity: .22, depthWrite: false }),
    coins: standard("#9c7a2c", { transparent: true, opacity: .30, depthWrite: false }),
    flight: standard("#6f8f52", { transparent: true, opacity: .20, depthWrite: false }),
  };
  const zoneEdge = {
    ante: mat(new THREE.LineBasicMaterial({ color: "#a9c6da", transparent: true, opacity: .62 })),
    coins: mat(new THREE.LineBasicMaterial({ color: "#e0b967", transparent: true, opacity: .70 })),
    flight: mat(new THREE.LineBasicMaterial({ color: "#b3cd8c", transparent: true, opacity: .62 })),
  };
  const activeZoneBorderMat = mat(new THREE.LineBasicMaterial({ color: "#f1d89a", transparent: true, opacity: .95 }));
  const activeZoneMaterial = standard("#e7c781", { transparent: true, opacity: .23, depthWrite: false });
  const targetZoneBorderMat = mat(new THREE.LineBasicMaterial({ color: "#e8a0a0", transparent: true, opacity: .9 }));
  const targetZoneMaterial = standard("#c87778", { transparent: true, opacity: .2, depthWrite: false });
  const priceGlowGeo = geo(new THREE.PlaneGeometry(W * 1.11, H * 1.08));
  const priceGlowMat = mat(new THREE.MeshBasicMaterial({ color: "#ffdb76", transparent: true, opacity: .85, depthWrite: false, toneMapped: false }));
  const effectGlowGeo = geo(new THREE.PlaneGeometry(W * 1.16, H * 1.11));
  const effectGlowMat = mat(new THREE.MeshBasicMaterial({ color: "#ffd67b", transparent: true, opacity: .7, depthWrite: false, toneMapped: false }));
  const readyGlowMat = mat(new THREE.MeshBasicMaterial({ color: "#ffe3a1", transparent: true, opacity: .82, depthWrite: false, toneMapped: false }));
  const playableGlowMat = mat(new THREE.MeshBasicMaterial({ color: "#a7c5cf", transparent: true, opacity: .38, depthWrite: false, toneMapped: false }));
  const resolutionGlowMat = mat(new THREE.MeshBasicMaterial({ color: "#d8b5ff", transparent: true, opacity: .84, depthWrite: false, toneMapped: false }));
  const resolutionPulseGeo = geo(new THREE.RingGeometry(.82, .88, 48));
  const resolutionLinkGeo = geo(new THREE.BufferGeometry());
  const resolutionLinkMat = mat(new THREE.LineBasicMaterial({ color: "#e8a0a0", transparent: true, opacity: .58, depthTest: false, toneMapped: false }));
  const resolutionTargetMarkerGeos: Record<PowerTargetRelation, THREE.BufferGeometry> = {
    direct: geo(new THREE.RingGeometry(.12, .16, 24)),
    choice: geo(new THREE.RingGeometry(.12, .16, 4)),
    payment: geo(new THREE.RingGeometry(.12, .16, 12)),
    transfer: geo(new THREE.RingGeometry(.12, .16, 3)),
    swap: geo(new THREE.RingGeometry(.12, .16, 6)),
  };
  const resolutionTargetMarkerMat = mat(new THREE.MeshBasicMaterial({ color: "#e8a0a0", transparent: true, opacity: .72, depthTest: false, toneMapped: false }));
  // A small, static family glyph lives on the owner's ready hand card. It is
  // deliberately separate from the public burst geometry: the marker is
  // private presentation, while bursts are only driven by public events.
  /** A glowing edge for a private hand card whose power will fire. It replaces
   *  the old family glyph and its ring: the card keeps its printed face, and the
   *  only added mark is a border in that ability family's colour. */
  const OUTLINE_PLANE_X = 1.16, OUTLINE_PLANE_Y = 1.14;
  const powerOutlineGeo = geo(new THREE.PlaneGeometry(W * OUTLINE_PLANE_X, H * OUTLINE_PLANE_Y));
  /** A burning gold edge for a private hand card whose power will fire. One
   *  colour for every ability family: the printed face already names the dragon,
   *  so the mark only has to say that this card will fire. */
  const powerOutlineMat = mat(new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color("#f0c064") }, uPulse: { value: .5 }, uSweep: { value: 0 },
      uAspect: { value: (W * OUTLINE_PLANE_X) / (H * OUTLINE_PLANE_Y) },
      // The card's own half extents in the shader's aspect-corrected units, so
      // the border follows the card instead of the plane that carries it.
      uBox: { value: new THREE.Vector2(W / (H * OUTLINE_PLANE_Y) / 2, 1 / (OUTLINE_PLANE_Y * 2)) },
      uWidth: { value: .03 }, uCorner: { value: .12 },
    },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    // Four straight glowing lines along the card's edges carrying two
    // interfering travelling waves, so the mark reads as flame licking along
    // the card rather than a moving dot. The lines deliberately stop short of
    // the corners: inside each corner square the band fades out over the arc's
    // span, so the glow never wraps around a rounded corner.
    fragmentShader: "uniform vec3 uColor; uniform float uPulse; uniform float uSweep; uniform float uAspect; uniform vec2 uBox; uniform float uWidth; uniform float uCorner; varying vec2 vUv; void main() { vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0); vec2 q = abs(p) - uBox; float dist = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0); float band = smoothstep(uWidth, uWidth * 0.15, abs(dist)); float corner = min(abs(p.x) - (uBox.x - uCorner), abs(p.y) - (uBox.y - uCorner)); band *= 1.0 - smoothstep(0.0, uCorner * 0.85, corner); if (band <= 0.001) discard; float flame = 0.5 + 0.5 * sin(6.28318 * (vUv.y * 1.6 - uSweep * 2.0)); float ripple = 0.5 + 0.5 * sin(6.28318 * (vUv.x * 2.4 + uSweep * 3.0)); float lick = 0.42 + 0.58 * (flame * 0.7 + ripple * 0.3); gl_FragColor = vec4(uColor, band * lick * (0.5 + uPulse * 0.5)); }",
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  const formationOuterGeo = geo(new THREE.RingGeometry(1.03, 1.09, 48));
  // Class silhouettes: what the power does, drawn on the felt under the card.
  const classChevronGeo = geo(new THREE.RingGeometry(.30, .37, 3));
  const classCardFanGeo = geo(new THREE.PlaneGeometry(.1, .5));
  const classChainGeo = geo(new THREE.RingGeometry(.20, .26, 20));
  const classCoinRingGeo = geo(new THREE.RingGeometry(.46, .52, 6));
  const classCrownRingGeo = geo(new THREE.RingGeometry(.40, .45, 5));
  const formationTriangleGeo = geo(new THREE.RingGeometry(.61, .66, 3));
  const formationSquareGeo = geo(new THREE.RingGeometry(.58, .64, 4));
  const formationPentagonGeo = geo(new THREE.RingGeometry(.58, .64, 5));
  const formationWaveGeo = geo(new THREE.RingGeometry(.72, .77, 40));
  const formationLeafGeo = geo(new THREE.CircleGeometry(.23, 6));
  const formationSpokeGeo = geo(new THREE.PlaneGeometry(.028, 1.7));
  const flightColorMarkerGeo = geo(new THREE.RingGeometry(.74, .785, 40));
  const flightStrengthMarkerGeo = geo(new THREE.RingGeometry(.74, .785, 6));
  const flightMortalMarkerGeo = geo(new THREE.RingGeometry(.74, .785, 3));
  /** One reusable striking hand. Original outline, extruded like the coins. */
  const handShape = new THREE.Shape();
  handShape.moveTo(-.30, -.16); handShape.quadraticCurveTo(-.34, .06, -.26, .16);
  handShape.quadraticCurveTo(-.10, .26, .02, .24); handShape.quadraticCurveTo(.16, .22, .22, .12);
  for (let finger = 0; finger < 4; finger++) {
    const x = .20 + finger * .12;
    handShape.lineTo(x - .03, .30 + (finger === 1 ? .06 : 0));
    handShape.quadraticCurveTo(x + .05, .34 + (finger === 1 ? .06 : 0), x + .07, .26);
  }
  handShape.lineTo(.62, .16); handShape.quadraticCurveTo(.70, .04, .60, -.06);
  handShape.quadraticCurveTo(.40, -.22, .10, -.24); handShape.quadraticCurveTo(-.14, -.26, -.30, -.16); handShape.closePath();
  const handGeo = geo(new THREE.ExtrudeGeometry(handShape, { depth: .05, bevelEnabled: true, bevelSize: .012, bevelThickness: .012, bevelSegments: 1, curveSegments: 10 }));
  const handMat = standard("#c9a184", { roughness: .74 });
  const strikeHand = mesh(handGeo, handMat); strikeHand.visible = false; strikeHand.castShadow = false; strikeHand.receiveShadow = false; strikeHand.raycast = () => {};
  // The landing point needs its own feedback: the shake is felt, the hand is
  // seen, and this ring shows exactly where the palm hit the felt.
  const slapRingMat = new THREE.MeshBasicMaterial({ color: 0xfff3d8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const slapRing = mesh(geo(new THREE.RingGeometry(.52, .74, 56)), slapRingMat);
  slapRing.rotation.x = -Math.PI / 2; slapRing.visible = false; slapRing.raycast = () => {}; slapRing.castShadow = false; slapRing.receiveShadow = false; slapRing.userData.noShadow = true;
  const slapCues = new Map<string, { start: number; sequence: number }>();
  // A gesture stays broadcast for 30s, so the cue alone cannot tell "already
  // played" from "not yet played": without this ledger any later repaint would
  // replay the same strike.
  const slapSeen = new Map<string, number>();
  const SLAP_MS = 620;
  /** Single owner of the slap reset: a slap cue lives only until its impact ends,
   *  the table is rebuilt, or motion is suppressed. */
  function clearSlaps() { slapCues.clear(); scene.position.set(0, 0, 0); strikeHand.visible = false; slapRing.visible = false; slapRingMat.opacity = 0; }
  function syncSlaps() {
    if (!model.view) return;
    for (const seat of seatPlacements(model.view)) {
      const gesture = gestureValues.get(seat.id)?.value;
      // A repeated slap is a new gesture: key off its sequence so hammering the
      // button restarts the impact instead of being swallowed by the last one.
      if (gesture?.slap && slapSeen.get(seat.id) !== gesture.sequence) { slapSeen.set(seat.id, gesture.sequence); slapCues.set(seat.id, { start: performance.now(), sequence: gesture.sequence }); requestFrame(); }
    }
    if (model.reducedMotion) clearSlaps();
  }
  function tickSlaps(now: number): boolean {
    let live = false;
    for (const [seatId, cue] of slapCues) {
      const progress = (now - cue.start) / SLAP_MS;
      if (progress >= 1) { slapCues.delete(seatId); continue; }
      live = true;
      const eased = progress * (2 - progress);
      // The whole scene takes the impact, so the coins, the cards and the
      // seating light all jolt together and the ray casting follows for free.
      const fall = 1 - eased, jolt = Math.sin(progress * Math.PI * 9) * .085 * fall;
      scene.position.set(jolt, -Math.abs(jolt) * .55, jolt * .4);
      if (!model.reducedMotion) {
        const seat = seatPlacements(model.view!).find(value => value.id === seatId);
        if (seat) {
          // `n` is the outward normal: hand cards sit at seat + n * 2.15. The
          // palm therefore travels *inward*, from just above the player's own
          // edge down onto the felt, so the player who slaps sees it land
          // instead of losing it behind their own fan.
          const reach = .95 + eased * 3.05;
          const lift = 2.3 - eased * 1.75 + Math.sin(progress * Math.PI) * .25;
          strikeHand.visible = true;
          strikeHand.position.set(seat.x - seat.nx * reach, lift, seat.z - seat.nz * reach);
          // A slight diagonal keeps the fingers readable from above; a square-on
          // reach would foreshorten them into a blob.
          strikeHand.rotation.set(-Math.PI / 2 + eased * .5, seat.angle + Math.PI / 2 + .34, 0, "YXZ");
          strikeHand.scale.setScalar(1.4);
          // The ring appears as the palm arrives and swells outwards while it
          // fades, so the impact has a readable point rather than a vague shake.
          const land = Math.max(0, Math.min(1, (progress - .45) / .55));
          slapRing.visible = land > 0;
          slapRing.position.set(seat.x - seat.nx * 3.6, .06, seat.z - seat.nz * 3.6);
          slapRing.scale.setScalar(.55 + land * 1.7);
          slapRingMat.opacity = .55 * land * (1 - land * .15);
        }
      }
    }
    if (!live) { scene.position.set(0, 0, 0); strikeHand.visible = false; slapRing.visible = false; slapRingMat.opacity = 0; }
    return live;
  }
  const smokeTexture = tex((() => {
    const source = document.createElement("canvas"); source.width = source.height = 64;
    const context = source.getContext("2d")!;
    const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 31);
    gradient.addColorStop(0, "rgba(231,220,214,.62)"); gradient.addColorStop(.42, "rgba(181,164,170,.30)"); gradient.addColorStop(1, "rgba(120,105,116,0)");
    context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
    const result = new THREE.CanvasTexture(source); result.colorSpace = THREE.SRGBColorSpace; result.needsUpdate = true; return result;
  })());
  const coinGeo=geo(currencyGeometry('gold')),silverGeo=geo(currencyGeometry('silver'));
  const goldMat=[standard("#fff6db",{map:tex(currencyTexture('gold',()=>requestFrame())),metalness:.4,roughness:.48}),standard("#98732b",{metalness:.65,roughness:.4})];
  const silverMat=[standard("#eeeeed",{map:tex(currencyTexture('silver',()=>requestFrame())),metalness:.42,roughness:.5}),standard("#858888",{metalness:.7,roughness:.4})];
  const dragLineGeo = geo(new THREE.BufferGeometry()); dragLineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(25 * 3), 3));
  const dragLine = new THREE.Line(dragLineGeo, mat(new THREE.LineBasicMaterial({ color: "#e5c280", transparent: true, opacity: .65, depthTest: false })));
  dragLine.visible = false; dragLine.renderOrder = 10; scene.add(dragLine);
  const resolutionLink = new THREE.Line(resolutionLinkGeo, resolutionLinkMat); resolutionLink.visible = false; resolutionLink.renderOrder = 11; resolutionLink.frustumCulled = false; powerEffectsGroup.add(resolutionLink);
  const resolutionTargetMarker = mesh(resolutionTargetMarkerGeos.direct, resolutionTargetMarkerMat, powerEffectsGroup); resolutionTargetMarker.rotation.x = -Math.PI / 2; resolutionTargetMarker.visible = false; resolutionTargetMarker.renderOrder = 12; resolutionTargetMarker.frustumCulled = false;
  const dragArrowMat = mat(new THREE.MeshBasicMaterial({ color: "#ffd98a", transparent: true, opacity: .92, depthTest: false, toneMapped: false }));
  const dragArrow = mesh(geo(new THREE.ConeGeometry(.15, .42, 16)), dragArrowMat, scene); dragArrow.visible = false; dragArrow.renderOrder = 11; dragArrow.raycast = () => {};
  const landing = mesh(geo(new THREE.RingGeometry(.62, .66, 40)), mat(new THREE.MeshBasicMaterial({ color: "#f0ce83", transparent: true, opacity: .8, depthWrite: false }))); landing.rotation.x = -Math.PI / 2; landing.visible = false;
  let model: StageModel = { view: null, language: "en" }, previousView: StageModel["view"] = null;
  let destroyed = false, explicitSuspend = false, contextLost = false, raf = 0, frames = 0, width = 0, height = 0;
  let qualityMode: StageQualityMode = options.quality ?? "auto";
  let activeQuality: Exclude<StageQualityLevel, "unavailable"> = qualityMode === "low" ? "low" : "high";
  let qualityReason: StageQuality["reason"] = qualityMode === "auto" ? undefined : "manual";
  let reportedQuality: StageQualityLevel | null = null;
  let reportedQualityMode: StageQualityMode | null = null;
  const coarsePointer = matchMedia("(pointer: coarse)");
  let handPowerLastRender = 0;
  let drag: { cardId: string; origin: Pose; offsetX: number; offsetY: number; ndcX?: number; ndcY?: number } | null = null, pending: { cardId: string; gameId: string } | null = null;
  let zoneSignature = "", infoSignature = "";
  const revealQueue: RevealData[] = [];
  const deferredMoney: { before: NonNullable<StageModel["view"]>; after: NonNullable<StageModel["view"]> }[] = [];
  let goldFlowSignature="";
  let revealCue: RevealCue | null = null;
  let revealPhase: RevealPhase | null = null;
  const powerPulses = new Map<string, PowerPulse>(), powerBursts = new Map<string, PowerBurst>(); let powerPulseSignature = "", powerBurstSignature = "";
  const handPowerCueStarts = new Map<string, number>(); let handPowerCueReady = new Set<string>();
  const PLACE_MS = 250, FLIP_MS = 360, FLASH_MS = 640, PAYMENT_MS = REVEAL_PRESENTATION_MS - PLACE_MS - FLIP_MS - FLASH_MS;
  const gestureValues = new Map<string, { value: HandGesture; expires: number; timer: ReturnType<typeof setTimeout> }>();
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const fanRotation = new THREE.Quaternion(), fanTurn = new THREE.Quaternion();
  const fanAxis = new THREE.Vector3(0, 0, 1), faceUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const fanEuler = new THREE.Euler(0, 0, 0, "YXZ");
  const hidden = () => explicitSuspend || contextLost || document.hidden || width <= 0 || height <= 0;
  function resolveQuality(mode: StageQualityMode): { level: Exclude<StageQualityLevel, "unavailable">; reason: StageQuality["reason"] } {
    if (mode === "high") return { level: "high", reason: "manual" };
    if (mode === "low") return { level: "low", reason: "manual" };
    // There is no user-facing quality switch any more, so an automatic
    // downgrade has to be reserved for genuinely constrained surfaces: a
    // touch-primary device, or a window too small to show the table. A
    // mouse-driven desktop window of ordinary size is never silently reduced,
    // and a modest memory hint is no longer a reason to drop the shadow pass.
    const rect = canvas.getBoundingClientRect();
    const shortSide = Math.min(rect.width || window.innerWidth, rect.height || window.innerHeight);
    if (coarsePointer.matches) return { level: "low", reason: "auto-coarse-input" };
    if (shortSide > 0 && shortSide <= 480) return { level: "low", reason: "auto-small-screen" };
    return { level: "high", reason: undefined };
  }
  function applyQuality(mode = qualityMode): boolean {
    qualityMode = mode;
    const resolved = resolveQuality(mode), changed = resolved.level !== activeQuality;
    activeQuality = resolved.level; qualityReason = resolved.reason;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, activeQuality === "high" ? 1.75 : 1.15));
    renderer.shadowMap.enabled = activeQuality === "high";
    renderer.shadowMap.autoUpdate = false;
    const shadows = activeQuality === "high";
    scene.traverse(object => {
      const value = object as THREE.Mesh;
      if (!value.isMesh) return;
      // Decorative light and glow meshes are flagged so a quality change can
      // never promote them into shadow casters: a shaft of light must not
      // darken the felt behind it.
      if (value.userData.noShadow) { value.castShadow = false; value.receiveShadow = false; return; }
      value.castShadow = shadows;
      value.receiveShadow = shadows;
    });
    if (changed) { infoSignature = ""; zoneSignature = ""; }
    if (reportedQuality !== activeQuality || reportedQualityMode !== qualityMode || changed) {
      reportedQuality = activeQuality;
      reportedQualityMode = qualityMode;
      options.onQuality?.({ webgl: true, quality: activeQuality, mode: qualityMode, reason: qualityReason });
    }
    return changed;
  }
  const face = (placement: CardPlacement) => {
    if (!placement.card) return { material: backMat, key: "back" };
    const id = `${model.language}:${placement.card.id}`;
    let material = faces.get(id); if (!material) { material = mat(new THREE.MeshBasicMaterial({map:tex(cardTexture(placement.card, model.language, requestFrame)),toneMapped:false})); faces.set(id, material); }
    return { material, key: id };
  };
  function publicFormations(view: StageModel["view"]): FlightFormation[] {
    return view?.seats.map(seat => { const kind = publicFlightFormation(seat); return kind ? { seatId: seat.id, kind } : null; }).filter((value): value is FlightFormation => !!value) ?? [];
  }
  function requestFrame() { if (!destroyed && !hidden() && !raf) raf = requestAnimationFrame(tick); }
  function clearPowerPulses() {
    for (const pulse of powerPulses.values()) { pulse.object.removeFromParent(); materials.delete(pulse.material); pulse.material.dispose(); }
    powerPulses.clear();
  }
  function clearPowerBursts() {
    for (const burst of powerBursts.values()) {
      burst.group.removeFromParent(); materials.delete(burst.formationMaterial); burst.formationMaterial.dispose();
      materials.delete(burst.smokeMaterial); burst.smokeMaterial.dispose();
    }
    powerBursts.clear();
    resolutionLink.visible = false; resolutionTargetMarker.visible = false;
  }
  function resolutionVisual(id: string) {
    const view = model.view;
    const publicIds = new Set(view ? [...view.ante, ...view.discard, ...view.revealed, ...view.seats.flatMap(seat => seat.flight.map(entry => entry.card))].map(value => value.id) : []);
    return [...visuals.values(), ...(revealCue?.cards ?? [])].find(value => value.placement.cardId === id && value.group.visible && value.group.parent?.visible && value.faceKey !== "back" && (publicIds.has(id) || !!revealCue?.cards.includes(value)));
  }
  function syncResolutionLink() {
    const source = (model.activeResolutionCardIds ?? []).map(id => resolutionVisual(id)).find(Boolean), targetId = model.resolutionTargetSeatId;
    const target = targetId ? zoneGroup.children.find(child => { const hit = child.userData.hit as StageHit | undefined; return hit?.zone === "flight" && hit.seatId === targetId; }) : undefined;
    if (!source || !target) { resolutionLink.visible = false; resolutionTargetMarker.visible = false; return; }
    const relation = model.resolutionTargetRelation ?? "direct";
    const bend = { direct: .42, choice: .66, payment: .24, transfer: .38, swap: .28 }[relation] ?? .42;
    resolutionLink.userData.targetRelation = relation;
    resolutionLinkMat.opacity = relation === "choice" ? .76 : relation === "payment" ? .5 : .62;
    const accent = powerEffectTheme(model.activeResolutionFamily ?? source.placement.card?.family).pulseColor;
    resolutionLinkMat.color.set(accent); resolutionTargetMarkerMat.color.set(accent); resolutionTargetMarkerMat.opacity = relation === "choice" ? .86 : relation === "payment" ? .64 : .76;
    source.group.updateWorldMatrix(true, false); target.updateWorldMatrix(true, false);
    const from = source.group.getWorldPosition(new THREE.Vector3()), to = target.getWorldPosition(new THREE.Vector3()), points:THREE.Vector3[] = [];
    for (let index = 0; index <= 10; index++) { const t = index / 10, swapWave = relation === "swap" ? Math.sin(Math.PI * 2 * t) * .11 : 0; points.push(new THREE.Vector3(THREE.MathUtils.lerp(from.x, to.x, t), .13 + Math.sin(Math.PI * t) * bend + swapWave, THREE.MathUtils.lerp(from.z, to.z, t))); }
    resolutionLinkGeo.setFromPoints(points); resolutionLink.visible = true; resolutionTargetMarker.geometry = resolutionTargetMarkerGeos[relation]; resolutionTargetMarker.position.set(to.x, .18, to.z); resolutionTargetMarker.scale.setScalar(relation === "choice" || relation === "swap" ? 1.12 : 1); resolutionTargetMarker.userData.targetRelation = relation; resolutionTargetMarker.visible = true;
  }
  function syncPowerPulses() {
    const ids = [...new Set(model.activeResolutionCardIds ?? [])], visibleIds = ids.filter(id => !!resolutionVisual(id)), signature = `${visibleIds.join("\u0000")}\u0000${model.activeResolutionFamily ?? ""}`;
    if (model.reducedMotion || hidden()) { if (powerPulses.size) clearPowerPulses(); powerPulseSignature = ""; return; }
    if (!visibleIds.length) { if (powerPulses.size) clearPowerPulses(); powerPulseSignature = ""; return; }
    // A pulse is a one-shot cue. Its source may remain active while a choice
    // panel is open; do not restart the ring every time its finite animation
    // reaches zero.
    if (signature === powerPulseSignature) return;
    clearPowerPulses(); powerPulseSignature = signature;
    for (const id of visibleIds) {
      const visual = resolutionVisual(id); if (!visual) continue;
      const theme = powerEffectTheme(model.activeResolutionFamily ?? resolutionVisual(id)?.placement.card?.family);
      const material = mat(new THREE.MeshBasicMaterial({ color: theme.pulseColor, transparent: true, opacity: .72, depthWrite: false, toneMapped: false }));
      const object = mesh(resolutionPulseGeo, material, visual.group); object.rotation.x = -Math.PI / 2; object.position.y = .018; object.scale.setScalar(.82);
      powerPulses.set(id, { object, material, start: performance.now() });
    }
    if (powerPulses.size) requestFrame();
  }
  function tickPowerPulses(now: number) {
    for (const [id, pulse] of powerPulses) {
      const progress = (now - pulse.start) / 760;
      if (progress >= 1) { pulse.object.removeFromParent(); materials.delete(pulse.material); pulse.material.dispose(); powerPulses.delete(id); continue; }
      const eased = progress * (2 - progress); pulse.object.scale.setScalar(.82 + eased * .28); pulse.object.rotation.z = eased * Math.PI * .5; pulse.material.opacity = .72 * (1 - progress);
    }
  }
  function makePowerBurst(id: string, source: Visual) {
    const theme = powerEffectTheme(model.activeResolutionFamily ?? source.placement.card?.family);
    const group = new THREE.Group(); group.renderOrder = 12; powerEffectsGroup.add(group);
    source.group.updateWorldMatrix(true, false); source.group.getWorldPosition(group.position); source.group.getWorldQuaternion(group.quaternion);
    group.scale.setScalar(source.group.getWorldScale(new THREE.Vector3()).x || 1);
    const formationMaterial = mat(new THREE.MeshBasicMaterial({ color: theme.formationColor, transparent: true, opacity: .76, depthWrite: false, depthTest: false, toneMapped: false }));
    const formation = new THREE.Group(); group.add(formation);
    const glyph = (geometry: THREE.BufferGeometry, rotation = 0, scale = 1, x = 0, z = 0) => {
      const object = mesh(geometry, formationMaterial, formation); object.rotation.x = -Math.PI / 2; object.rotation.z = rotation; object.position.set(x, .041, z); object.scale.setScalar(scale); return object;
    };
    // Each family has a small, legible table glyph. Color is only one cue;
    // the silhouette and motion also tell fire, tide, grove, arcane and crown
    // apart without turning every power into the same particle explosion.
    switch (theme.shape) {
      case "ember":
        glyph(formationOuterGeo, 0, 1, 0, 0); glyph(formationTriangleGeo, 0, 1, 0, 0);
        for (const angle of [0, Math.PI / 3, Math.PI * 2 / 3]) glyph(formationSpokeGeo, angle, .75);
        break;
      case "tide":
        glyph(formationOuterGeo, 0, 1, 0, 0); glyph(formationWaveGeo, Math.PI / 40, 1, 0, 0);
        glyph(formationWaveGeo, -Math.PI / 40, .7, 0, 0);
        break;
      case "grove":
        glyph(formationOuterGeo, 0, .92, 0, 0);
        for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 3 / 2]) {
          const leaf = glyph(formationLeafGeo, angle, 1, Math.cos(angle) * .32, Math.sin(angle) * .32); leaf.scale.set(.52, 1.25, 1);
        }
        break;
      case "arcane":
        glyph(formationSquareGeo, Math.PI / 4, 1.05, 0, 0);
        for (const angle of [Math.PI / 4, Math.PI * 3 / 4]) glyph(formationSpokeGeo, angle, .74);
        break;
      case "crown":
        glyph(formationPentagonGeo, -Math.PI / 2, 1.08, 0, 0);
        for (const angle of [0, Math.PI * 2 / 5, Math.PI * 4 / 5, Math.PI * 6 / 5, Math.PI * 8 / 5]) glyph(formationSpokeGeo, angle, .58);
        break;
    }
    // The class layer: one silhouette and one element flight per kind of power.
    const effect = classEffect(abilityClass(model.activeResolutionFamily ?? source.placement.card?.family));
    const classGlyph = (geometry: THREE.BufferGeometry, rotation: number, scale: number, offset = 0) => {
      const object = mesh(geometry, formationMaterial, formation);
      object.rotation.x = -Math.PI / 2; object.rotation.z = rotation;
      object.position.set(Math.cos(rotation) * offset, .043, Math.sin(rotation) * offset);
      object.scale.setScalar(scale); object.raycast = () => {}; return object;
    };
    if (effect.glyph === "chevron") { classGlyph(classChevronGeo, 0, 1.5); classGlyph(classChevronGeo, Math.PI * 2 / 3, 1.5); classGlyph(classChevronGeo, Math.PI * 4 / 3, 1.5); }
    else if (effect.glyph === "card-fan") { for (const step of [-1, 0, 1]) classGlyph(classCardFanGeo, step * .38 - Math.PI / 2, 1, .72); }
    else if (effect.glyph === "chain") { classGlyph(classChainGeo, 0, 1, .3); classGlyph(classChainGeo, 0, 1, -.3); }
    else if (effect.glyph === "coin-ring") { for (let index = 0; index < 6; index++) classGlyph(classCoinRingGeo, index / 6 * Math.PI * 2, .5, .74); }
    else { classGlyph(classCrownRingGeo, -Math.PI / 2, 1.2); }
    formation.scale.setScalar(effect.ring);
    const smokeMaterial = mat(new THREE.SpriteMaterial({ map: smokeTexture, color: theme.smokeColor, transparent: true, opacity: theme.smokeOpacity, depthWrite: false, depthTest: false, sizeAttenuation: true }));
    const puffs: PowerBurst["puffs"] = [];
    for (let index = 0; index < (activeQuality === "high" ? 6 : 3); index++) {
      const angle = index / 6 * Math.PI * 2 + (id.charCodeAt(index % id.length) % 17) / 40;
      const puff = new THREE.Sprite(smokeMaterial); puff.position.y = .06; puff.scale.setScalar(.16 + index % 3 * .035); puff.renderOrder = 13; group.add(puff);
      puffs.push({ object: puff, angle, distance: .22 + (index % 3) * .12, rise: .2 + (index % 2) * .12, size: .16 + index % 3 * .035, spin: index % 2 ? -1 : 1 });
    }
    if (effect.flight !== "none" && !model.reducedMotion && !hidden()) {
      const anchor = effect.from === "stakes" ? stakesAnchor.position : effect.from === "hole" ? holeAnchor.position : effect.from === "deck" ? new THREE.Vector3(DECK.x, .2, DECK.z) : effect.from === "discard" ? new THREE.Vector3(DISCARD.x, .2, DISCARD.z) : source.group.position;
      for (let index = 0; index < (activeQuality === "high" ? 3 : 2); index++) {
        const element = effect.flight === "coin" ? mesh(coinGeo, goldMat[0], transferGroup) : mesh(cardPlane, backMat, transferGroup);
        if (effect.flight === "card") { element.rotation.set(Math.PI / 2, 0, 0, "YXZ"); element.scale.setScalar(.34); }
        element.position.set(anchor.x + index * .06, effect.from === "self" ? anchor.y + .3 : .24, anchor.z + index * .06);
        element.raycast = () => {};
        const landing = source.group.position.clone(); landing.y += effect.flight === "card" ? .34 : .22;
        move(element, { x: landing.x + index * .07, y: landing.y, z: landing.z + index * .07, yaw: 0, tilt: effect.flight === "card" ? Math.PI / 2 : 0, scale: effect.flight === "card" ? .34 : 1 }, true, .9 + index * .08, false, () => transferGroup.remove(element), 620);
      }
    }
    powerBursts.set(id, { group, source, formation, formationMaterial, smokeMaterial, themeKey: theme.key, shape: theme.shape, rotation: theme.rotation, smokeBaseOpacity: theme.smokeOpacity, puffs, start: performance.now() });
  }
  function syncPowerBursts() {
    const ids = [...new Set(model.activeResolutionCardIds ?? [])], visibleIds = ids.filter(id => !!resolutionVisual(id)), signature = `${visibleIds.join("\u0000")}\u0000${model.activeResolutionFamily ?? ""}`;
    if (model.reducedMotion || hidden()) { if (powerBursts.size) clearPowerBursts(); if (powerBursts.size || slapCues.size) { powerBurstSignature = ""; }
      // A reduced-motion or hidden table shows no burst; the slap cue is owned by
      // syncSlaps, which clears it for the same two conditions. Only the beam
      // easing is snapped here.
      beams.forEach(beam => { beam.start = 0; beam.focus = beam.target; beam.presence = beam.targetPresence; placeBeam(beam, beam.focus); }); return; }
    if (!visibleIds.length) { if (powerBursts.size) clearPowerBursts(); powerBurstSignature = ""; beams.forEach(beam => { beam.start = 0; beam.focus = beam.target; beam.presence = beam.targetPresence; placeBeam(beam, beam.focus); }); return; }
    // Formation and smoke are one finite event per source change, not a
    // continuous ambient particle system. This keeps the table calm and lets
    // reduced-motion users disable the entire cue without losing information.
    if (signature === powerBurstSignature) return;
    clearPowerBursts(); powerBurstSignature = signature;
    for (const id of visibleIds) { const source = resolutionVisual(id); if (source) makePowerBurst(id, source); }
    if (powerBursts.size) requestFrame();
  }
  function tickPowerBursts(now: number) {
    for (const [id, burst] of powerBursts) {
      const progress = (now - burst.start) / 980;
      const source = burst.source;
      if (!source.group.parent) { burst.group.removeFromParent(); materials.delete(burst.formationMaterial); burst.formationMaterial.dispose(); materials.delete(burst.smokeMaterial); burst.smokeMaterial.dispose(); powerBursts.delete(id); continue; }
      source.group.updateWorldMatrix(true, false); source.group.getWorldPosition(burst.group.position); source.group.getWorldQuaternion(burst.group.quaternion); burst.group.scale.setScalar(source.group.getWorldScale(new THREE.Vector3()).x || 1); burst.group.visible = source.group.visible;
      if (progress >= 1) { burst.group.removeFromParent(); materials.delete(burst.formationMaterial); burst.formationMaterial.dispose(); materials.delete(burst.smokeMaterial); burst.smokeMaterial.dispose(); powerBursts.delete(id); continue; }
      const eased = progress * (2 - progress), fade = 1 - Math.max(0, (progress - .18) / .82);
      burst.formation.scale.setScalar(.84 + eased * .32); burst.formation.rotation.y = eased * Math.PI * burst.rotation; burst.formationMaterial.opacity = .76 * fade;
      burst.puffs.forEach(puff => { const radius = puff.distance + eased * .42; puff.object.position.set(Math.cos(puff.angle) * radius, .06 + eased * puff.rise, Math.sin(puff.angle) * radius); puff.object.scale.setScalar(puff.size * (1 + eased * 1.35)); puff.object.material.rotation = puff.spin * eased * 1.8; });
      burst.smokeMaterial.opacity = burst.smokeBaseOpacity * fade;
    }
  }
  /** The seating light. Presentation only: it reads the same public
   *  activeSeatId the DOM turn hint uses, never a private card or a queue. */
  /** Binds the fixed set of shafts to the current seats. This runs on every
   *  projection, deliberately outside the region rebuild's signature cache: a
   *  seat's committed flag changes without changing the table, and a cached
   *  rebuild would leave the light burning for a seat that already ante'd. */
  function assignBeams() {
    const view = model.view, seats = view ? seatPlacements(view) : [];
    beams.forEach((beam, index) => {
      const seat = seats[index];
      if (!seat) { beam.group.visible = false; beam.seatId = ""; beam.committed = false; beam.start = 0; beam.focus = 0; beam.presence = 0; beam.target = 0; beam.targetPresence = 0; return; }
      beam.seatId = seat.id;
      beam.committed = !!view?.seats.find(value => value.id === seat.id)?.committed;
      beam.from = { x: seat.ante.x, z: seat.ante.z };
      // Focused, the shaft covers that seat's hand, not just its regions.
      beam.to = { x: seat.x + seat.nx * 2.4, z: seat.z + seat.nz * 2.4 };
      // Keeps any fade that is already running.
      placeBeam(beam, beam.focus);
    });
  }
  function syncSpotlight(animate: boolean) {
    const view = model.view;
    const activeSeatId = view && (view.phase === "play" || view.phase === "choice") ? view.activeSeatId : null;
    // The light follows the phase. While antes are being placed every seat has
    // one, and it goes out as soon as that seat commits, so the lights still
    // burning are exactly who the table is waiting for. Once the ante phase
    // ends those lights are cleared and only the acting seat keeps one, aimed
    // at its hand. No other phase carries a light at all.
    const ante = view?.phase === "ante";
    const acting = view?.phase === "play" || view?.phase === "choice";
    let animating = false;
    for (const beam of beams) {
      const on = !!beam.seatId && (ante ? !beam.committed : acting && beam.seatId === activeSeatId);
      const wanted = on && acting && beam.seatId === activeSeatId ? 1 : 0;
      const presence = on ? 1 : 0;
      // A fade that was interrupted by a hidden or suspended surface leaves the
      // value short of its target. Comparing targets alone would then skip it
      // forever, so an unsettled beam is snapped to its target instead.
      // A light that is going out keeps the focus it already has: it fades away
      // where it is instead of shrinking back over its seat's ante area first,
      // which is what made a small light appear to linger through a hand-over.
      const focusTarget = presence > 0 ? wanted : beam.focus;
      const sameTarget = beam.target === focusTarget && beam.targetPresence === presence;
      const arrived = beam.focus === focusTarget && beam.presence === presence;
      if (sameTarget && (arrived || beam.start)) continue;
      beam.target = focusTarget; beam.targetPresence = presence;
      // Only a shaft that is already burning slides to its new place. One that
      // is fading in arrives straight at its seat, so a turn change never
      // flashes a small light back over the ante area first.
      if (!animate || model.reducedMotion || sameTarget) { beam.focus = focusTarget; beam.presence = presence; beam.start = 0; placeBeam(beam, focusTarget); }
      else {
        // Opacity always eases. The focus only travels when a light that is
        // already burning moves to a new place; a light that is coming on
        // arrives straight at its seat, and one that is going out holds its
        // place while it dims, so neither direction shows a small light
        // lingering over the ante area during a hand-over.
        const moves = beam.presence > .01 && presence > .01;
        beam.fromFocus = moves ? beam.focus : focusTarget;
        beam.fromPresence = beam.presence;
        beam.start = performance.now();
        animating = true;
      }
    }
    if (animating) requestFrame();
  }
  function tickSpotlight(now: number): boolean {
    let animating = false;
    for (const beam of beams) {
      if (!beam.start) continue;
      const progress = (now - beam.start) / FOCUS_MS;
      if (progress >= 1) { beam.focus = beam.target; beam.presence = beam.targetPresence; beam.start = 0; placeBeam(beam, beam.focus); continue; }
      const eased = progress * (2 - progress);
      beam.focus = beam.fromFocus + (beam.target - beam.fromFocus) * eased;
      beam.presence = beam.fromPresence + (beam.targetPresence - beam.fromPresence) * eased;
      placeBeam(beam, beam.focus); animating = true;
    }
    return animating;
  }
  const motionKey = (object: THREE.Object3D) => { const hit = object.userData.hit as StageHit | undefined; return `${hit?.zone ?? "?"}:${hit && "cardId" in hit ? hit.cardId : hit?.seatId ?? "?"}`; };
  function finishMotions() { for (const motion of [...motions.values()]) { setPose(motion.object, motion.to); motion.done?.(); } motions.clear(); }
  function tick(now: number) {
    raf = 0; if (destroyed || hidden()) return;
    tickReveal(now);
    tickPowerPulses(now);
    tickPowerBursts(now);
    const spotActive = tickSpotlight(now);
    const slapActive = tickSlaps(now);
    const handPowerActive = tickHandPowerEffects(now);
    for (const [object, motion] of motions) {
      const t = Math.max(0, Math.min(1, (now - motion.start) / motion.duration));
      const ease = t * t * (3 - 2 * t), p = motion.from, q = motion.to;
      const bounce = motion.bounce && t > .82 ? Math.sin((t - .82) / .18 * Math.PI) * .035 : 0;
      setPose(object, { x: THREE.MathUtils.lerp(p.x, q.x, ease), y: THREE.MathUtils.lerp(p.y, q.y, ease) + Math.sin(Math.PI * t) * motion.arc + bounce,
        z: THREE.MathUtils.lerp(p.z, q.z, ease), yaw: THREE.MathUtils.lerp(p.yaw, q.yaw, ease), tilt: THREE.MathUtils.lerp(p.tilt, q.tilt, ease),
        roll: THREE.MathUtils.lerp(p.roll ?? 0, q.roll ?? 0, ease) + (motion.flip ? Math.PI * (1 - ease) : 0), scale: THREE.MathUtils.lerp(p.scale, q.scale, ease) });
      if (t >= 1) { setPose(object, q); motions.delete(object); motion.done?.(); }
    }
    // A ready-hand cue is ambient UI, not a gameplay animation. Keep its
    // render cadence around 30 FPS when it is the only live presentation so
    // portrait devices do not pay a full-rate scene render for a tiny glyph.
    const handPowerOnly = handPowerActive && !spotActive && !slapActive && !motions.size && !revealCue && !powerPulses.size && !powerBursts.size;
    if (handPowerOnly && now - handPowerLastRender < 1000 / 30) { requestFrame(); return; }
    renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); frames++;
    if (handPowerOnly) handPowerLastRender = now;
    if (motions.size || revealCue || powerPulses.size || powerBursts.size || handPowerActive || spotActive || slapActive) requestFrame();
  }
  function move(object: THREE.Object3D, to: Pose, animate: boolean, arc = .7, flip = false, done?: () => void, duration = 470) {
    if (!animate || model.reducedMotion || hidden()) { motions.delete(object); setPose(object, to); done?.(); return; }
    motions.set(object, { object, from: copyPose(object), to, start: performance.now(), duration, arc, flip, bounce: arc > 0, done });

  }
  function freeOwnedGroup(group: THREE.Group) {
    for (const child of [...group.children]) { motions.delete(child); group.remove(child); child.traverse(node => { if ((node as THREE.InstancedMesh).isInstancedMesh) (node as THREE.InstancedMesh).dispose(); const owned = node.userData.ownedMaterial as THREE.MeshBasicMaterial | undefined;
      if (owned) { if (owned.map) { textures.delete(owned.map); owned.map.dispose(); } materials.delete(owned); owned.dispose(); } }); }
  }
  function label(parent: THREE.Object3D, text: string, position: THREE.Vector3, size = 2.8, muted = false,accent?:string) {
    const material = mat(new THREE.MeshBasicMaterial({ map: tex(labelTexture(text, muted,accent)), transparent: true, depthWrite: false, toneMapped: false }));
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
    const shadowed = activeQuality === "high";
    const body = mesh(cardBody, edgeMat, group); body.castShadow = shadowed; body.receiveShadow = shadowed;
    const front = mesh(cardPlane, backMat, group); front.rotation.x = -Math.PI / 2; front.position.y = THICKNESS / 2 + .001; front.receiveShadow = shadowed;
    const back = mesh(cardPlane, backMat, group); back.rotation.x = Math.PI / 2; back.position.y = -THICKNESS / 2 - .001;
    const effectGlow = mesh(effectGlowGeo, effectGlowMat, group); effectGlow.rotation.x = -Math.PI / 2; effectGlow.position.y = .011; effectGlow.visible = false;
    const powerOutline = mesh(powerOutlineGeo, powerOutlineMat, group);
    // The glow sits just under the printed face, so the opaque card body hides
    // whatever of it falls on the card and only the spill around the silhouette
    // shows. Above the face it painted a border straight over the card art.
    powerOutline.rotation.x = -Math.PI / 2; powerOutline.position.y = THICKNESS / 2 - .004; powerOutline.renderOrder = 4; powerOutline.visible = false;
    return { group, body, front, back, effectGlow, powerOutline, faceKey: "back", placement };
  }
  function syncEffectGlows() {
    const active = new Set(model.activeEffectCardIds ?? []), resolving = new Set(model.activeResolutionCardIds ?? []), view = model.view;
    const publicIds = new Set(view ? [...view.ante, ...view.discard, ...view.revealed, ...view.seats.flatMap(seat => seat.flight.map(entry => entry.card))].map(value => value.id) : []);
    const privateView = view && "selfSeatId" in view ? view as SeatView : null;
    const omniscient = view && "omniscient" in view && view.omniscient === true ? view as OmniscientView : null;
    const handPowerBySeat = new Map<string, Map<string, "power-ready" | "playable-no-power">>();
    if (privateView) handPowerBySeat.set(privateView.selfSeatId, new Map(privateView.handPowerHints.map(hint => [hint.cardId, hint.state]).filter((entry): entry is [string, "power-ready" | "playable-no-power"] => entry[1] === "power-ready" || entry[1] === "playable-no-power")));
    if (omniscient) for (const [seatId, hints] of Object.entries(omniscient.privateHandPowerHints)) handPowerBySeat.set(seatId, new Map(hints.map(hint => [hint.cardId, hint.state]).filter((entry): entry is [string, "power-ready" | "playable-no-power"] => entry[1] === "power-ready" || entry[1] === "playable-no-power")));
    const nextHandPowerReady = new Set<string>();
    for (const visual of [...visuals.values(), ...(revealCue?.cards ?? [])]) {
      const id = visual.placement.cardId;
      // Temporary reveal faces are from a new, already public ANTE_REVEALED
      // event. Never turn an active ID into private face or texture knowledge.
      const publicFace = !!id && (publicIds.has(id) || !!revealCue?.cards.includes(visual));
      const handState = id && visual.placement.zone === "hand" ? handPowerBySeat.get(visual.placement.seatId ?? "")?.get(id) : undefined;
      const privateReady = handState === "power-ready";
      const privatePlayable = handState === "playable-no-power";
      const privateFace = !!id && visual.placement.zone === "hand" && visual.placement.seatId === privateView?.selfSeatId && visual.faceKey !== "back";
      const resolvingCard = !!id && resolving.has(id) && (publicFace || privateFace) && visual.faceKey !== "back";
      visual.effectGlow.material = resolvingCard ? resolutionGlowMat : effectGlowMat;
      visual.powerOutline.visible = privateReady;
      if (privateReady && id) { nextHandPowerReady.add(id); if (!handPowerCueReady.has(id)) handPowerCueStarts.set(id, performance.now()); }
      if (!privateReady) { const settled = (visual.powerOutline.material as THREE.ShaderMaterial).uniforms; settled.uPulse.value = .6; settled.uSweep.value = .35; }
      visual.effectGlow.visible = resolvingCard || publicFace && visual.faceKey !== "back" && active.has(id!);
      visual.group.userData.powerState = privateReady ? "power-ready" : privatePlayable ? "playable-no-power" : resolvingCard ? "resolving" : active.has(id!) ? "active-effect" : "";
    }
    for (const id of handPowerCueReady) if (!nextHandPowerReady.has(id)) handPowerCueStarts.delete(id);
    handPowerCueReady = nextHandPowerReady;
  }
  function tickHandPowerEffects(now: number): boolean {
    if (model.reducedMotion || hidden()) return false;
    let active = false;
    // A touch device or a small canvas gets the still edge: the same mark with
    // no animation, so a phone never pays for a permanent redraw.
    const still = coarsePointer.matches || canvas.clientWidth < 700;
    for (const visual of visuals.values()) {
      if (!visual.group.visible || visual.group.userData.powerState !== "power-ready" || !visual.powerOutline.visible) continue;
      const uniforms = (visual.powerOutline.material as THREE.ShaderMaterial).uniforms;
      if (still) { uniforms.uSweep.value = .35; uniforms.uPulse.value = .6; continue; }
      // The flame keeps burning for as long as the card is ready. Both waves are
      // driven from one wrapping clock, so the loop has no visible seam, and
      // nothing is recomputed in JavaScript beyond two uniforms. The renderer
      // already caps an otherwise idle scene to 30 FPS, which is what keeps a
      // continuous hand cue affordable.
      const seed = (visual.placement.cardId?.charCodeAt(0) ?? 0) * .017;
      uniforms.uSweep.value = (now / 1800 + seed) % 1;
      uniforms.uPulse.value = .5 + .5 * Math.sin(now / 900 + seed);
      active = true;
    }
    return active;
  }
  function presentationVisibility() {
    const active = revealCue?.data;
    const compactOwnSeat = width <= 580 && model.view && "selfSeatId" in model.view ? model.view.selfSeatId : null;
    for (const visual of visuals.values()) {
      const ownHandUsesDom = !!compactOwnSeat && visual.placement.zone === "hand" && visual.placement.seatId === compactOwnSeat;
      visual.group.visible = !ownHandUsesDom && (!active || visual.placement.key === pending?.cardId || visual.placement.key === drag?.cardId ||
        !(active.cards.some(card => card.placement.cardId === visual.placement.cardId) || visual.placement.zone === "ante" && active.cards.some(card => card.placement.seatId === visual.placement.seatId)));
    }
    for (const visual of revealCue?.cards ?? []) visual.group.visible = visual.placement.cardId !== pending?.cardId && visual.placement.cardId !== drag?.cardId;
    syncEffectGlows();
    syncPowerPulses();
    syncPowerBursts();
    syncResolutionLink();
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
     const signature = JSON.stringify([view?.id, view?.seats.map(s => [s.id, s.flight.map(entry => [entry.cardId, entry.wild ?? false, entry.rider ?? false]), s.strength, s.scoringStrength, s.gold]), selfId, model.language, legal, model.resolutionTargetSeatId ?? null, model.resolutionTargetRelation ?? null, model.activeResolutionFamily ?? "", view?.deckCount,view?.discard.length]);
     if (signature === zoneSignature) return; zoneSignature = signature; freeOwnedGroup(zoneGroup);
     if(model.resolutionTargetSeatId){const theme=powerEffectTheme(model.activeResolutionFamily);targetZoneBorderMat.color.set(theme.formationColor);targetZoneMaterial.color.set(theme.pulseColor);}
    const zoneWords = (kind: StageZone, width: number) => model.language === "zh"
      ? { ante: "暗置区", coins: "金币区", flight: "牌阵", deck: "牌库", discard: "弃牌堆", hand: "手牌", stakes: "公共下注区" }[kind]
      : { ante: "ANTE", coins: "GOLD", flight: "FLIGHT", deck: "DECK", discard: "DISCARD", hand: "HAND", stakes: "STAKES" }[kind];
    /** A flat region plate. Seat strips carry their rounded ends; the shared
     *  piles stay plain rectangles. */
    const plate = (kind: StageZone, pose: Pose, width: number, depth: number, seatId: string | undefined, strip?: SeatStripZone) => {
      const active = !!selfId && seatId === selfId && kind === legal;
      const target = !!model.resolutionTargetSeatId && seatId === model.resolutionTargetSeatId && kind === "flight";
      const roundStart = strip?.roundStart ?? false, roundEnd = strip?.roundEnd ?? false;
      const geometry = plateGeo(width, depth, roundStart, roundEnd);
      const fill = kind === "ante" ? zoneFill.ante : kind === "coins" ? zoneFill.coins : kind === "flight" ? zoneFill.flight : zoneMaterial;
      const object = mesh(geometry.mesh, active ? activeZoneMaterial : target ? targetZoneMaterial : fill, zoneGroup);
      object.rotation.x = -Math.PI / 2; object.rotation.z = pose.yaw;
      object.position.set(pose.x, .052, pose.z);
      object.userData.highlight = active;
      object.userData.hit = { kind: "zone", zone: kind, ...(seatId ? { seatId } : {}) } satisfies StageHit;
      const edge = kind === "ante" ? zoneEdge.ante : kind === "coins" ? zoneEdge.coins : kind === "flight" ? zoneEdge.flight : zoneBorderMat;
      object.add(new THREE.Line(geometry.outline, active ? activeZoneBorderMat : target ? targetZoneBorderMat : edge));
      // The region name is a translucent slab across the plate instead of a
      // caption underneath it, so the felt stays readable as a table.
      const material = mat(new THREE.MeshBasicMaterial({ map: tex(zoneLabelTexture(zoneWords(kind, width), width / depth)), transparent: true, opacity: .30, depthWrite: false, toneMapped: false }));
      const text = mesh(zoneLabelGeo, material, zoneGroup);
      text.rotation.set(-Math.PI / 2, 0, pose.yaw); text.position.set(pose.x, .058, pose.z);
      text.scale.set(width * .86, depth * .86, 1);
      text.userData.ownedMaterial = material; text.raycast = () => {};
      return object;
    };
    /** The round marker for one region. It is centred over that region and
     *  seated on the region's own top edge as seen from the camera, so it reads
     *  as part of the strip instead of floating over the felt. The primary
     *  number is the current total; the smaller line is the scoring total and
     *  appears only when a power changes it. */
    const badge = (zone: Pose, depth: number, gap: number, main: string, sub: string | undefined, accent: string) => {
      // Placed in the region's own frame on the side that faces the table
      // centre, centred along the strip. The viewer's own region therefore has
      // its badge above it, and no seat's badge ever lands on its own cards.
      const normalX = Math.sin(zone.yaw), normalZ = Math.cos(zone.yaw);
      const material = mat(new THREE.MeshBasicMaterial({ map: tex(badgeTexture(main, sub, accent)), transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
      const object = mesh(badgeGeo, material, zoneGroup);
      // The offset uses the region's real depth: the viewer's own strip is
      // deeper than the others, and a constant here put its badge inside the
      // plate instead of on its inner edge.
      object.position.set(zone.x - normalX * (depth / 2 + gap), .30, zone.z - normalZ * (depth / 2 + gap));
      object.quaternion.copy(camera.quaternion); object.renderOrder = 30;
      object.userData.ownedMaterial = material; object.raycast = () => {};
      return object;
    };
    plate("deck", DECK, W * 1.18, H * 1.1 * 1.1, undefined); plate("discard", DISCARD, W * 1.18, H * 1.1 * 1.1, undefined);

    if (view) for (const seat of seatPlacements(view)) {
      const publicSeat = view.seats.find(value => value.id === seat.id)!;
      for (const strip of seat.strip) plate(strip.kind, strip.kind === "ante" ? seat.ante : strip.kind === "coins" ? seat.coins : seat.flight, strip.width, strip.depth, seat.id, strip);
      const differs = publicSeat.scoringStrength !== publicSeat.strength;
      const accent = seatColors[Math.max(0, view.seats.findIndex(value => value.id === seat.id)) % seatColors.length];
      const zoneDepth = (kind: string) => seat.strip.find(strip => strip.kind === kind)?.depth ?? ZONE_DEPTH;
      // Tangent placement, derived from geometry instead of tuned numbers: the
      // badge circle touches its region's inner edge, so its centre sits exactly
      // one radius beyond that edge. The region's own depth gives the edge, so
      // every seat and every table shape reads identically.
      // The badge straddles its region's inner edge: half the circle sits on
      // the plate, half outside it, which reads as "attached to the edge" in
      // every layout. Measured, not tuned: the plate's inner edge is at
      // zone - depth/2, and the circle's radius comes from the badge texture
      // (74px of an 80px half-canvas on a BADGE_SIZE plane).
      // The viewer's own strip is drawn with a different plate depth than the
      // other seats, so its badge needs its own geometry: the owner's badge
      // sits half a badge height inside the edge, every other seat is tangent
      // to it. Both values are measured against what is actually rendered.
      const gap = seat.self ? -BADGE_SIZE / 4 : BADGE_SIZE / 2;
      badge(seat.flight, seat.self ? ZONE_DEPTH : zoneDepth("flight"), gap, String(publicSeat.strength), differs ? String(publicSeat.scoringStrength) : undefined, accent);
      badge(seat.coins, seat.self ? ZONE_DEPTH : zoneDepth("coins"), gap, `${publicSeat.gold}`, undefined, "#efce86");
      const formation = publicFlightFormation(publicSeat);
      if (formation) {
        const markerGeometry = formation === "color" ? flightColorMarkerGeo : formation === "strength" ? flightStrengthMarkerGeo : flightMortalMarkerGeo;
        const markerColor = formation === "color" ? "#e6b86f" : formation === "strength" ? "#b7d7e4" : "#d8b5ff";
        const material = mat(new THREE.MeshBasicMaterial({ color: markerColor, transparent: true, opacity: .66, depthWrite: false, toneMapped: false }));
        const marker = mesh(markerGeometry, material, zoneGroup); marker.rotation.x = -Math.PI / 2; marker.position.set(seat.flight.x, .067, seat.flight.z); marker.scale.setScalar(.92); marker.userData.ownedMaterial = material; marker.raycast = () => {};
        const formationText = model.language === "zh" ? ({ color: "同色牌阵", strength: "同点牌阵", mortal: "凡人牌阵" } as const)[formation] : ({ color: "COLOR FLIGHT", strength: "MATCHED STRENGTH", mortal: "MORTAL FLIGHT" } as const)[formation];
        const formationLabel = label(zoneGroup, formationText, new THREE.Vector3(seat.flight.x, .074, seat.flight.z - 1.1), 1.15, false, markerColor); formationLabel.raycast = () => {};
      }
    }
  }
  function moneyLocation(seatId: string) {
    const point=model.view?moneyPlacement(model.view,seatId):{x:0,z:0};return new THREE.Vector3(point.x,.24,point.z);
  }

  function refreshInfo() {
    const view = model.view, signature = JSON.stringify([model.language, view?.id, view?.seats.map(s => [s.id, s.name, s.gold, s.debt, s.strength]), view?.stakes, view?.hole, view?.deckCount, view?.discard.length, view?.activeSeatId]);
    if (signature === infoSignature) return; infoSignature = signature; freeOwnedGroup(infoGroup); freeOwnedGroup(moneyGroup); freeOwnedGroup(stackGroup);
    if (!view) { label(infoGroup, model.language === "zh" ? "三龙牌" : "THREE DRAGON ANTE", new THREE.Vector3(0, .5, 0), 5); return; }
    // Only anonymous paper edges beneath the exposed top card. Public counts
    // determine height; at most two draw calls and sixteen representative layers.
    const cardStack = (pose: Pose, count: number, step: number) => {
      if (count < 2) return;
      const height = pileTop(count, step) - THICKNESS / 2 - .004;
       const layers = Math.min(activeQuality === "high" ? 8 : 4, count - 1), spacing = height / layers;
       const instances = new THREE.InstancedMesh(cardBody, edgeMat, layers);
       const transform = new THREE.Object3D(); instances.castShadow = activeQuality === "high"; instances.receiveShadow = activeQuality === "high";
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
      const at=moneyPlacement(view,id),ownerIndex=view.seats.findIndex(seat=>seat.id===id),color=seatColors[ownerIndex]??'#dbc287';
      // Mesh counts are bounded stacks; the adjacent label is the exact LE gold
      // total. Silver is decorative equivalent change, never a game resource.
       for (const [metal, count] of [[goldMat, Math.min(activeQuality === "high" ? 24 : 12, denominations.gold)], [silverMat, Math.min(activeQuality === "high" ? denominations.silver : 6, denominations.silver)]] as const) {
        if (!count) continue;
         const instances = new THREE.InstancedMesh(metal===silverMat?silverGeo:coinGeo, metal, count); const transform = new THREE.Object3D(); instances.castShadow = activeQuality === "high"; instances.receiveShadow = activeQuality === "high";
        // Stable small offsets give loose stacks without changing when a room
        // update arrives. Keep the far card corners clear for strength/inspection.
        const seed=[...id].reduce((sum,c)=>sum+c.charCodeAt(0),0);
        for(let i=0;i<count;i++){
          const silver=metal===silverMat,heights=silver?[6,4]:[8,5,7,4];
          let stack=0,level=i;while(level>=heights[stack]){level-=heights[stack];stack++;}
          const jitter=(salt:number)=>(Math.sin(seed*12.9898+salt*78.233)*43758.5453%1)*.035;
          const offsets=silver?[[-.21,-.32],[.19,-.23]]:[[-.20,.05],[.19,.17],[-.14,.54],[.27,.62]];
          const x=offsets[stack][0]+jitter(i+1),z=offsets[stack][1]+jitter(i+53);
          transform.position.set(pos.x+Math.cos(at.yaw)*x+Math.sin(at.yaw)*z,pos.y+level*.042,pos.z-Math.sin(at.yaw)*x+Math.cos(at.yaw)*z);
          transform.rotation.set(0,0,0);transform.updateMatrix();instances.setMatrixAt(i,transform.matrix);
        }
        instances.userData.owner=id;

        moneyGroup.add(instances);
      }
       // The shared pools keep their exact caption; a seat's gold is carried by
       // its round coin badge, so no second amount text is drawn over the tray.
       if(id==='stakes'||id==='hole'){
         const value=id==='stakes'?(model.language==='zh'?`公共下注 · ${amount}金`:`Stakes · ${amount}g`):(model.language==='zh'?`偿债池 · ${amount}金`:`Hole · ${amount}g`);
         label(infoGroup,value,new THREE.Vector3(at.x,1,at.z-.6),2.5,false,id==='hole'?'#c7a6d4':color);
       }

    };
    pile("stakes", view.stakes); pile("hole", view.hole);
    for (const seat of seatPlacements(view)) {
      const value = view.seats.find(s => s.id === seat.id)!; pile(seat.id, value.gold);
      const active = view.activeSeatId === seat.id ? "◆ " : "";
      if(!seat.self)label(infoGroup,active+value.name,new THREE.Vector3(Math.sin(seat.angle)*7.5,.55,Math.cos(seat.angle)*7.5),2.4,false,seatColors[view.seats.findIndex(other=>other.id===seat.id)]);
      if (value.debt) label(infoGroup, `${model.language === "zh" ? "欠债" : "Debt"} ${value.debt}`, moneyLocation(seat.id).add(new THREE.Vector3(.3, .2, 1)), 1.8, true);
    }
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
         const object = mesh(coinGeo, goldMat, transferGroup); object.castShadow = activeQuality === "high"; const from = moneyLocation(source[0]), to = moneyLocation(target[0]);
        object.position.copy(from).add(new THREE.Vector3(i * .08, .35, 0));
        move(object, { x: to.x + i * .06, y: .35, z: to.z, yaw: 0, tilt: 0, scale: 1 }, true, 1.5 + i * .08, false, () => { transferGroup.remove(object); });
      }
    }
  }
  function animateGoldFlows(flows: readonly StageGoldFlow[]) {
    if (model.reducedMotion || hidden()) return;
    let budget=16;
    for (const flow of flows) {
      if (flow.fromSeatId===flow.toSeatId || !Number.isSafeInteger(flow.amount) || flow.amount<=0) continue;
      const from=moneyLocation(flow.fromSeatId),to=moneyLocation(flow.toSeatId);
      for (let i=0;i<Math.min(4,flow.amount)&&budget-- > 0;i++) {
         const object=mesh(coinGeo,goldMat,transferGroup);object.castShadow=activeQuality === "high";object.userData.goldFlow={key:flow.key,code:flow.code??""};
        object.position.copy(from).add(new THREE.Vector3(i*.08,.35,0));
        move(object,{x:to.x+i*.06,y:.35,z:to.z,yaw:0,tilt:0,scale:1},true,1.5+i*.08,false,()=>transferGroup.remove(object),760);
      }
    }
  }
  function syncGoldFlows(flows: readonly StageGoldFlow[],allowAnimation:boolean) {
    const signature=flows.map(flow=>flow.key).join("\u0000");
    if(signature===goldFlowSignature)return;
    goldFlowSignature=signature;
    if(allowAnimation&&flows.length)animateGoldFlows(flows);
  }
  function animatePayments(payments: RevealData["payments"]) {
    let budget = 12;
    for (const payment of payments) for (let i = 0; i < Math.min(4, payment.amount) && budget-- > 0; i++) {
       const object = mesh(coinGeo, goldMat, transferGroup); object.castShadow = activeQuality === "high";
      const from = moneyLocation(payment.seatId), to = moneyLocation("stakes"); object.position.copy(from).add(new THREE.Vector3(i * .08, .35, 0));
      object.userData.payment = { ...payment };
      move(object, { x: to.x + i * .06, y: .35, z: to.z, yaw: 0, tilt: 0, scale: 1 }, true, 1.5 + i * .08, false, () => transferGroup.remove(object), PAYMENT_MS);
    }
  }
  function adjusted(placement: CardPlacement): Pose {
    const value = { ...placement.pose };
    if (placement.zone === "hand" && placement.card && placement.seatId && model.view && "selfSeatId" in model.view && placement.seatId === model.view.selfSeatId && width && height) {
      const hand = (model.view as SeatView).hand, index = hand.findIndex(c => c.id === placement.cardId);
      const offset = index - (hand.length - 1) / 2;
      const cardPixels = Math.max(95, Math.min(144, width * .12));
      const spacing = Math.min(cardPixels * .73, Math.max(10, (width - 32 - cardPixels) / Math.max(1, hand.length - 1)));
      const x = width / 2 + offset * spacing, y = height - cardPixels * .89 - 36 + Math.min(36, offset * offset * 2);
      const ndc = new THREE.Vector3(x / width * 2 - 1, 1 - y / height * 2, -1).unproject(camera);
      const direction = camera.getWorldDirection(new THREE.Vector3());
      const handPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(direction, new THREE.Vector3(0, 3.5, 5));
      const point = new THREE.Ray(ndc, direction).intersectPlane(handPlane, new THREE.Vector3());
      // Keep the private fan on the table's near edge. On a tall viewport the
      // projected fan position falls past the timber and below the felt, into
      // the dark surround, where the cards read as if a black mask covered
      // them. Clamping the depth and height holds the fan on the edge for every
      // aspect ratio, not just the wide one.
      if (point) { point.z = Math.min(point.z, 8.3); point.y = Math.max(point.y, .55); }
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
      if (visuals.has(id) || !placement.seatId || !["hand", "ante", "flight"].includes(placement.zone)) continue;
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
    for (const [id, visual] of visuals) if (!desired.has(id) && pending?.cardId !== id && drag?.cardId !== id) { if (motions.has(visual.group)) motions.delete(visual.group); scene.remove(visual.group); visuals.delete(id); }
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
    syncTableShape(); rebuildZones(); refreshInfo(); assignBeams(); syncSpotlight(animate); syncSlaps(); presentationVisibility(); requestFrame();
  }
  function clearInteraction() { drag = null; pending = null; dragLine.visible = landing.visible = false; }
  function clearGestures() { for (const entry of gestureValues.values()) clearTimeout(entry.timer); gestureValues.clear(); }
  function resize() {
    if (destroyed) return; const rect = canvas.getBoundingClientRect(); width = Math.floor(rect.width); height = Math.floor(rect.height);
    if (width <= 0 || height <= 0) { if (raf) cancelAnimationFrame(raf); raf = 0; return; }
    const qualityChanged = applyQuality();
    renderer.setSize(width, height, false);
    const aspect = width / height;
    // Portrait has a real DOM hand rail, so the canvas can spend more of its
    // narrow width on the table itself. Keep a little world-space margin for
    // the radial seats while avoiding the desktop camera's large empty sides.
    const half = Math.max(8.3, (aspect < 1 ? 9.6 : 11.2) / aspect);
    camera.left = -half * aspect; camera.right = half * aspect; camera.top = half * (aspect < 1 ? .8 : 1); camera.bottom = -half * (aspect < 1 ? 1.2 : 1); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    // The local hand is a real mesh foreground fan, sized in projected pixels;
    // it remains usable on portrait screens instead of shrinking with the table.
    for (const visual of visuals.values()) if (visual.placement.zone === "hand" && visual.placement.card && visual.placement.key !== drag?.cardId && visual.placement.key !== pending?.cardId) { if (motions.has(visual.group)) motions.delete(visual.group); setPose(visual.group, adjusted(visual.placement)); }
    if (qualityChanged && model.view) refreshInfo();
    presentationVisibility();
    requestFrame();
  }
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  const visibility = () => { if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; clearReveal(); clearPowerPulses(); clearPowerBursts(); powerPulseSignature = ""; powerBurstSignature = ""; beams.forEach(beam => { beam.start = 0; beam.focus = beam.target; beam.presence = beam.targetPresence; placeBeam(beam, beam.focus); }); clearSlaps(); finishMotions(); clearInteraction(); clearGestures(); } else { reconcile(false); resize(); } };
  const lost = (event: Event) => { event.preventDefault(); contextLost = true; reportedQuality = "unavailable"; if (raf) cancelAnimationFrame(raf); raf = 0; clearReveal(); clearPowerPulses(); clearPowerBursts(); powerPulseSignature = ""; powerBurstSignature = ""; beams.forEach(beam => { beam.start = 0; beam.focus = beam.target; beam.presence = beam.targetPresence; placeBeam(beam, beam.focus); }); clearSlaps(); finishMotions(); clearInteraction(); options.onQuality?.({ webgl: false, quality: "unavailable", mode: qualityMode, reason: "context-lost" }); };
  const restored = () => { if (destroyed) return; contextLost = false; reportedQuality = "unavailable"; applyQuality(); resize(); reconcile(false); };
  document.addEventListener("visibilitychange", visibility); canvas.addEventListener("webglcontextlost", lost); canvas.addEventListener("webglcontextrestored", restored);
  /** Normalized-device ray. Unlike `setRay` it is deliberately not clipped to
   *  the canvas rectangle: a drag must keep tracking once the grabbed point
   *  leaves the canvas instead of freezing the card under the pointer. */
  const setDragRay = (nx: number, ny: number) => { pointer.set(nx, ny); camera.updateMatrixWorld(); scene.updateMatrixWorld(true); ray.setFromCamera(pointer, camera); return true; };
  /** Client pixels of a normalized-device point, clamped into the canvas so a
   *  drop at the very edge still resolves against the nearest slot. */
  const clientFromNdc = (nx: number, ny: number) => { const rect = canvas.getBoundingClientRect(); return { x: Math.min(Math.max(rect.left + (nx + 1) / 2 * rect.width, rect.left + 1), rect.right - 1), y: Math.min(Math.max(rect.top + (1 - ny) / 2 * rect.height, rect.top + 1), rect.bottom - 1) }; };
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
    const point = visual&&["hand","flight"].includes(visual.placement.zone) ? target.localToWorld(new THREE.Vector3(-W * .34, .03, -H * .34)) : target.getWorldPosition(new THREE.Vector3());
    const projected = point.project(camera), rect = canvas.getBoundingClientRect();
    return { x: rect.left + (projected.x + 1) * rect.width / 2, y: rect.top + (1 - projected.y) * rect.height / 2, visible: !!target.visible && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && projected.z >= -1 && projected.z <= 1 };
  }
  applyQuality(); resize(); reconcile(false);
  const handle: StageHandle = {
    setQuality(mode) {
      if (destroyed || !["auto", "high", "low"].includes(mode)) return;
      const changed = applyQuality(mode);
      if (changed && model.view) refreshInfo();
      presentationVisibility(); requestFrame();
    },
    update(next) {
      if (destroyed) return; const before = model.view;
      const oldSelf = before && "selfSeatId" in before ? before.selfSeatId : null;
      const nextSelf = next.view && "selfSeatId" in next.view ? next.view.selfSeatId : null;
      const reset = !before || !next.view || before.id !== next.view.id || oldSelf !== nextSelf || next.view.revision < before.revision || next.animate === false || next.connected === false;
      const animate = !reset && next.view!.revision >= before!.revision && next.view!.revision <= before!.revision + 1;
       if (reset || !animate) { clearReveal(); clearPowerPulses(); clearPowerBursts(); powerPulseSignature = `${[...new Set(next.activeResolutionCardIds ?? [])].join("\u0000")}\u0000${next.activeResolutionFamily ?? ""}`; powerBurstSignature = `${[...new Set(next.activeResolutionCardIds ?? [])].join("\u0000")}\u0000${next.activeResolutionFamily ?? ""}`; goldFlowSignature = (next.goldFlows ?? []).map(flow => flow.key).join("\u0000"); clearInteraction(); clearGestures(); finishMotions(); }
      else if (before?.revision !== next.view?.revision) clearGestures();
      if (next.reducedMotion) { clearReveal(); clearPowerPulses(); clearPowerBursts(); powerPulseSignature = ""; powerBurstSignature = ""; beams.forEach(beam => { beam.start = 0; beam.focus = beam.target; beam.presence = beam.targetPresence; placeBeam(beam, beam.focus); }); clearSlaps(); finishMotions(); }
      const reveal = animate && !next.reducedMotion && next.view!.revision === before!.revision + 1 ? prepareReveal(before!, next.view!) : null;
      model = next; previousView = before;
      if (reveal && !hidden()) { if (revealCue) { if (revealQueue.length < 4) revealQueue.push(reveal); } else startReveal(reveal); }
      reconcile(animate);
       if (!reveal && animate && next.view!.revision !== before!.revision) {
         if (revealCue) { if (deferredMoney.length < 8) deferredMoney.push({ before: before!, after: next.view! }); }
         else if (!(next.goldFlows?.length)) animateMoney(previousView);
       }
       syncGoldFlows(next.goldFlows ?? [], !reset && animate && !reveal);
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
      if (!value) { const had = !!drag; drag = null; dragLine.visible = landing.visible = dragArrow.visible = false; if (had) reconcile(true); return; }
      if (pending || model.connected === false || !model.view || !("selfSeatId" in model.view)) return;
      const visual = visuals.get(value.cardId); if (!visual || visual.placement.zone !== "hand" || visual.placement.seatId !== (model.view as SeatView).selfSeatId || !setRay(value.x, value.y)) return;
      // The grab offset is stored in normalized device coordinates, so a window resize, a compact/full switch or a page scroll cannot desync the card from the pointer the way a pixel offset captured against one rect did.
      // The lifted card is centred on the pointer. A grab offset made the card
      // lag behind the cursor, so the visible card, the landing ring and the drop
      // verdict could all disagree; centring them makes the distance the pointer
      // travels and the distance the card travels the same by construction.
      if (!drag) drag = { cardId: value.cardId, origin: copyPose(visual.group), offsetX: 0, offsetY: 0 };
      if (drag.cardId !== value.cardId) return;
      const rect = canvas.getBoundingClientRect();
      const nx = (value.x - rect.left) / rect.width * 2 - 1 + drag.offsetX, ny = 1 - (value.y - rect.top) / rect.height * 2 + drag.offsetY;
      drag.ndcX = nx; drag.ndcY = ny;
      if (!setDragRay(nx, ny)) return;
      const normal = camera.getWorldDirection(new THREE.Vector3());
      const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(drag.origin.x, drag.origin.y, drag.origin.z).addScaledVector(normal, -.35));
      const point = ray.ray.intersectPlane(dragPlane, new THREE.Vector3()); if (!point) return;
      // The card lifts straight up from its own slot and stays there; it does
      // not chase the pointer. The curved arrow carries the direction instead,
      // so the pointer, the arrow head, the landing ring and the drop verdict
      // are always the same point.
      motions.delete(visual.group); visual.group.position.set(drag.origin.x, drag.origin.y + .42, drag.origin.z);
      visual.group.rotation.set(Math.PI / 2 + camera.rotation.x, 0, 0, "YXZ"); visual.group.scale.setScalar(drag.origin.scale * 1.14);
      const origin = new THREE.Vector3(drag.origin.x, drag.origin.y, drag.origin.z), end = point;
      const curve = new THREE.QuadraticBezierCurve3(origin, origin.clone().lerp(end, .5).add(new THREE.Vector3(0, 1.6, 0)), end);
      const points = curve.getPoints(24), attribute = dragLineGeo.getAttribute("position");
      points.forEach((p, i) => attribute.setXYZ(i, p.x, p.y, p.z)); attribute.needsUpdate = true; dragLineGeo.computeBoundingSphere(); dragLine.visible = true;
      // The head sits at the pointer end and points along the curve, so the
      // guide reads as one sweep from the lifted card to the drop point.
      dragArrow.position.copy(end); dragArrow.lookAt(points[points.length - 2].clone().add(new THREE.Vector3(0, 1.6, 0)));
      dragArrow.rotateX(Math.PI / 2); dragArrow.visible = true;
       // The landing ring and the drop verdict both use the card's own point, not the raw pointer.
       const drop = clientFromNdc(nx, ny);
       const seat = seatPlacements(model.view).find(s => s.self), hit = handle.hitTest(drop.x, drop.y);
       const legal = model.legalDropZone;
       landing.visible = !!seat && !!legal && hit?.seatId === seat.id && hit.zone === legal;
       if (landing.visible && seat && legal) landing.position.set(seat[legal].x, .055, seat[legal].z);
       requestFrame();
    },
    /** Current drop point in client pixels, or null when nothing is dragged. The outer integration tests a drop here so the verdict and the visible card never disagree by the grab offset. */
    /** Local-only light intensity multiplier, for tuning the seating light. */
    setBeamIntensity(scale) { beamScale = Math.max(0, Math.min(3, Number(scale) || 0)); for (const beam of beams) placeBeam(beam, beam.focus); requestFrame(); },
    dragPoint() { return drag && drag.ndcX !== undefined && drag.ndcY !== undefined ? clientFromNdc(drag.ndcX, drag.ndcY) : null; },
    releaseDrag(value = {}) {
      if (!drag || destroyed) return; const id = drag.cardId;
      if (value.pending && model.view) { pending = { cardId: id, gameId: model.view.id }; const visual = visuals.get(id); const seat = seatPlacements(model.view).find(s => s.self);
        // The held card keeps its destination zone's size with a slight lift:
        // a hard-coded scale here made the card jump when it landed.
        if (visual && seat && value.zone) move(visual.group, { ...seat[value.zone], y: 1.05, tilt: .14, scale: (seat[value.zone].scale ?? 1) * 1.06 }, true, .6); }
      drag = null; dragLine.visible = landing.visible = dragArrow.visible = false; if (!pending) reconcile(true); else rebuildZones(); requestFrame();
    },
    resolvePending(_accepted) { if (destroyed || !pending) return; pending = null; reconcile(true); },
    gesture(seatId, value) {
      if (destroyed || !model.view) return; const old = gestureValues.get(seatId);
      if (value === null) { if (old) clearTimeout(old.timer); gestureValues.delete(seatId); reconcile(true); return; }
      const valid = readHandGesture(value), seat = model.view.seats.find(s => s.id === seatId);
      // Own-seat ordinals stay rejected: the real hand already shows them. A
      // slap carries no hand data and is public, so the slapping player is
      // allowed to see their own strike.
      if (!valid || !seat || valid.gameId !== model.view.id || valid.revision !== model.view.revision || valid.count !== seat.handCount || old && valid.sequence <= old.value.sequence || valid.slap !== true && "selfSeatId" in model.view && model.view.selfSeatId === seatId) return;
      if (old) clearTimeout(old.timer); const timer = setTimeout(() => { gestureValues.delete(seatId); if (!destroyed) reconcile(true); }, 30000);
      gestureValues.set(seatId, { value: valid, expires: Date.now() + 30000, timer }); reconcile(true);
    },
    // Two different questions. `settled` is "the played card has finished
    // landing and flipping" and gates the full-screen ability layer; `idle` is
    // "nothing on the table is animating at all" and gates the next phase, so
    // gold transfers and drawn cards finish before play moves on.
    settled() { return !destroyed && motions.size === 0 && !revealCue; },
    idle() { return !destroyed && motions.size === 0 && !revealCue && powerPulses.size === 0 && powerBursts.size === 0; },
    suspend() { if (destroyed) return; explicitSuspend = true; if (raf) cancelAnimationFrame(raf); raf = 0; clearReveal(); clearPowerPulses(); clearPowerBursts(); powerPulseSignature = ""; powerBurstSignature = ""; beams.forEach(beam => { beam.start = 0; beam.focus = beam.target; beam.presence = beam.targetPresence; placeBeam(beam, beam.focus); }); clearSlaps(); clearInteraction(); clearGestures(); finishMotions(); },
    resume() { if (destroyed) return; explicitSuspend = false; reconcile(false); resize(); },
    destroy() {
      if (destroyed) return; destroyed = true; if (raf) cancelAnimationFrame(raf); raf = 0; clearReveal(); clearPowerPulses(); clearPowerBursts(); motions.clear(); clearInteraction(); clearGestures(); observer.disconnect();
      document.removeEventListener("visibilitychange", visibility); canvas.removeEventListener("webglcontextlost", lost); canvas.removeEventListener("webglcontextrestored", restored);
      scene.traverse(object => { if ((object as THREE.InstancedMesh).isInstancedMesh) (object as THREE.InstancedMesh).dispose(); });
      for (const item of textures) item.dispose(); for (const item of materials) item.dispose(); for (const item of geometries) item.dispose();
      textures.clear(); materials.clear(); geometries.clear(); faces.clear(); visuals.clear(); scene.clear(); renderer.renderLists.dispose(); renderer.dispose(); renderer.forceContextLoss();
    },
    diagnostics() { let meshes = 0; scene.traverse(object => { if ((object as THREE.Mesh).isMesh) meshes++; }); const view = model.view; const privateSeats = view && "omniscient" in view && view.omniscient === true ? new Set(Object.keys((view as OmniscientView).privateHands)) : view && "selfSeatId" in view ? new Set([(view as SeatView).selfSeatId]) : new Set<string>(); const ownHands = [...visuals.values()].filter(visual => visual.placement.zone === "hand" && !!visual.placement.cardId && privateSeats.has(visual.placement.seatId ?? "")); const handPowerStates = ownHands.map(visual => ({ cardId: visual.placement.cardId!, state: (visual.group.userData.powerState as "power-ready" | "playable-no-power" | "") ?? "" })); const handPowerOutlines = ownHands.map(visual => { const theme = powerEffectTheme(visual.placement.card?.family); return { cardId: visual.placement.cardId!, state: (visual.group.userData.powerState as "power-ready" | "playable-no-power" | "") ?? "", theme: theme.key, shape: theme.shape, visible: visual.powerOutline.visible, pulse: (visual.powerOutline.material as THREE.ShaderMaterial).uniforms.uPulse.value as number }; }); return { frames, animations: motions.size + (revealCue ? 1 : 0) + powerPulses.size + powerBursts.size, motions: motions.size, viewRevision: view ? view.revision : null, motionCards: [...motions.keys()].map(object => { const hit = object.userData.hit as StageHit | undefined; return `${hit?.zone ?? "?"}:${hit && "cardId" in hit ? hit.cardId : hit?.seatId ?? "?"}`; }), meshes, textures: textures.size, drawCalls: renderer.info.render.calls, suspended: hidden(), destroyed, pendingCardId: pending?.cardId ?? null, faceCardIds: [...visuals.values(), ...(revealCue?.cards ?? [])].filter(v => v.group.visible && v.faceKey !== "back").map(v => v.placement.cardId!).filter(Boolean), powerPulses: powerPulses.size, powerBursts: powerBursts.size, powerBurstThemes: [...powerBursts.values()].map(burst => burst.themeKey), powerBurstShapes: [...powerBursts.values()].map(burst => burst.shape), flightFormations: publicFormations(model.view), resolutionLinkVisible: resolutionLink.visible, resolutionTargetMarkerVisible: resolutionTargetMarker.visible, resolutionLinkRelation: resolutionLink.visible ? (resolutionLink.userData.targetRelation as StageDiagnostics["resolutionLinkRelation"] ?? null) : null, goldTransfers: transferGroup.children.filter(child => !!child.userData.goldFlow).length, handPowerStates, handPowerOutlines, beamStates: beams.map(beam => ({ seatId: beam.seatId, committed: beam.committed, presence: beam.presence, focus: beam.focus, targetPresence: beam.targetPresence, visible: beam.group.visible })), spotlightSeatId: view?.activeSeatId && beams.some(beam => beam.seatId === view!.activeSeatId && beam.group.visible) ? view.activeSeatId : null, spotlightAnimating: beams.some(beam => !!beam.start), slapStates: [...slapCues.entries()].map(([seatId, cue]) => ({ seatId, sequence: cue.sequence, start: cue.start })), sceneJolt: { x: scene.position.x, y: scene.position.y, z: scene.position.z }, strikeHandVisible: strikeHand.visible, slapRingVisible: slapRing.visible, quality: activeQuality, qualityMode, pixelRatio: renderer.getPixelRatio(), shadowsEnabled: renderer.shadowMap.enabled }; },
  };
  return handle;
}
