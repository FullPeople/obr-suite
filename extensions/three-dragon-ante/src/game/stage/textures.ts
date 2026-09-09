import * as THREE from "three";
import type { Card } from "../rules/cards";
import { cardName } from "../rules/prompts";

const inks: Record<string, string> = { black: "#8a879b", blue: "#719bc3", brass: "#c6ab6b", bronze: "#c69566", copper: "#cf936e", gold: "#e3c37a", green: "#8ea77d", red: "#ce7965", silver: "#becbd3", white: "#ddd7c6" };
function canvas(width: number, height: number) {
  const value = document.createElement("canvas"); value.width = width; value.height = height;
  return { canvas: value, ctx: value.getContext("2d")! };
}
function texture(value: HTMLCanvasElement) {
  const map = new THREE.CanvasTexture(value); map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4; return map;
}
function lines(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const chunks = text.includes(" ") ? text.split(" ") : [...text]; const result: string[] = [];
  let line = "";
  for (const part of chunks) { const next = line + (line && text.includes(" ") ? " " : "") + part;
    if (ctx.measureText(next).width > max && line) { result.push(line); line = part; } else line = next; }
  if (line) result.push(line); return result;
}
/** Entirely original canvas engraving, paper grain and geometric back. */
export function cardTexture(card: Card | null, language: "zh" | "en"): THREE.CanvasTexture {
	const { canvas: value, ctx } = canvas(512, 736);
	ctx.fillStyle = "#201819";
	ctx.fillRect(0, 0, 512, 736);
	const gradient = ctx.createLinearGradient(0, 0, 512, 736);
	gradient.addColorStop(0, "#584132");
	gradient.addColorStop(.55, "#2a2424");
	gradient.addColorStop(1, "#473328");
	ctx.fillStyle = gradient;
	ctx.fillRect(9, 9, 494, 718);
	ctx.strokeStyle = "#aa8651";
	ctx.lineWidth = 3;
	ctx.strokeRect(18, 18, 476, 700);
	ctx.strokeRect(28, 28, 456, 680);
	const accent = card ? inks[card.color ?? "gold"] : "#b19168";
	ctx.strokeStyle = accent;
	ctx.fillStyle = accent;
	if (!card) {
		ctx.save();
		ctx.translate(256, 368);
		for (let i = 0; i < 9; i++) {
			ctx.rotate(Math.PI / 9);
			ctx.globalAlpha = .45;
			ctx.strokeRect(-130, -130, 260, 260);
		}
		ctx.globalAlpha = 1;
		ctx.rotate(-Math.PI);
		ctx.font = "bold 108px Georgia";
		ctx.textAlign = "center";
		ctx.fillText("III", 0, 35);
		ctx.restore();
		return texture(value);
	}
	ctx.font = "bold 86px Georgia";
	ctx.textAlign = "left";
	ctx.fillText(String(card.strength), 42, 116);
	ctx.textAlign = "right";
	ctx.font = "bold 56px Georgia";
	ctx.fillText(String(card.strength), 468, 687);
	ctx.save();
	ctx.translate(88, 185);
	ctx.scale(1.88, 1.88);
	ctx.globalAlpha = .12;
	ctx.beginPath();
	ctx.arc(106, 70, 65, 0, Math.PI * 2);
	ctx.fill();
	ctx.globalAlpha = .9;
	if (card.category === "mortal") {
		ctx.beginPath();
		ctx.arc(91, 63, 25, 0, Math.PI * 2);
		ctx.fill();
		ctx.fill(new Path2D("M90 88Q40 110 30 170L155 170Q141 110 90 88M40 42L146 42L113 18L90 6L71 23Z"));
		ctx.globalAlpha = .55;
		ctx.fillRect(24, 72, 7, 113);
		ctx.beginPath();
		ctx.arc(27, 61, 13, 0, Math.PI * 2);
		ctx.stroke();
	} else {
		ctx.fill(new Path2D("M88 120Q55 54 12 28L33 83L7 110L58 111L48 148L92 131M99 120Q125 58 175 24L147 82L178 110L129 114L145 151L98 134"));
		ctx.fill(new Path2D("M50 181Q130 200 126 151Q124 138 106 121Q91 105 102 84L119 79L131 62L114 64L115 40L101 58L90 40L88 70Q62 93 80 125Q110 156 96 165Q67 181 43 155Q28 176 50 181Z"));
		ctx.strokeStyle = "#efe0b8";
		ctx.lineWidth = 1.5;
		ctx.globalAlpha = .6;
		ctx.stroke(new Path2D("M88 120L12 28M88 120L33 83M88 120L7 110M99 120L175 24M99 120L147 82M99 120L178 110M101 80L117 73M88 99L99 96M92 112L102 110"));
	}
	ctx.restore();
	ctx.globalAlpha = 1;
	ctx.fillStyle = "#f0dfbd";
	ctx.font = "bold 40px Georgia, 'Microsoft YaHei', serif";
	ctx.textAlign = "center";
	const name = cardName(card.id, language);
	let size = 40, wrapped = lines(ctx, name, 414);
	while (wrapped.length > 2 && size > 22) {
		size -= 2; ctx.font = `bold ${size}px Georgia, 'Microsoft YaHei', serif`;
		wrapped = lines(ctx, name, 414);
	}
	wrapped.forEach((line, i) => ctx.fillText(line, 256, 574 + i * 45));
	ctx.font = "22px Georgia, 'Microsoft YaHei', serif";
	ctx.fillStyle = accent;
	ctx.fillText(language === "zh" ? {
		standard: "龙",
		legendary: "传奇龙",
		mortal: "凡人"
	}[card.category] : card.category.toUpperCase(), 256, 677);
	return texture(value);
}
export function woodTexture(): THREE.CanvasTexture {
  const { canvas: value, ctx } = canvas(512, 512);
  const pixels = ctx.createImageData(512, 512); let seed = 1909;
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grain = Math.sin(y * .29 + Math.sin(x * .024) * 2.8) * 6 + Math.sin(y * 1.6 + x * .018) * 2;
    const noise = (seed / 0xffffffff - .5) * 7, plank = Math.floor(y / 128) % 2 * 5;
    const i = (y * 512 + x) * 4, edge = y % 128 < 2 ? -.25 : 0;
    pixels.data[i] = (87 + grain + noise + plank) * (1 + edge);
    pixels.data[i + 1] = (56 + grain * .6 + noise + plank) * (1 + edge);
    pixels.data[i + 2] = (38 + grain * .4 + noise + plank) * (1 + edge);
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  const result = texture(value); result.wrapS = result.wrapT = THREE.RepeatWrapping; result.repeat.set(1.6, 1.6); return result;
}

export function feltTexture(): THREE.CanvasTexture {
  const { canvas: value, ctx } = canvas(256, 256);
  const pixels = ctx.createImageData(256, 256); let seed = 253;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const shade = 216 + seed / 0xffffffff * 20 + (x % 2 === y % 2 ? 7 : 0);
    const i = (y * 256 + x) * 4;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = shade; pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  const result = texture(value); result.wrapS = result.wrapT = THREE.RepeatWrapping; result.repeat.set(7, 7); return result;
}

export function labelTexture(text: string, muted = false): THREE.CanvasTexture {
  const { canvas: value, ctx } = canvas(768, 160);
  ctx.fillStyle = muted ? "#bca882" : "#eed6a4";
  ctx.font = "600 64px Georgia, 'Microsoft YaHei', serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  while (ctx.measureText(text).width > 740 && parseInt(ctx.font.split(" ")[1]) > 24) {
    const size = parseInt(ctx.font.split(" ")[1]) - 2; ctx.font = `600 ${size}px Georgia, 'Microsoft YaHei', serif`;
  }
  ctx.fillText(text, 384, 80); return texture(value);
}
