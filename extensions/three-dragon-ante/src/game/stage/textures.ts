import * as THREE from "three";
import type { Card } from "../rules/cards";
import { cardName } from "../rules/prompts";
import {cardFaceURL} from "../card-images";
import {drawBackDragon} from "../card-art";

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
/** One lazy, owned texture per visible face. Dispose cancels late image work. */
export function cardTexture(card: Card | null, language: "zh" | "en", loaded:()=>void=()=>{}): THREE.CanvasTexture {
	if(card){
		const {canvas:value,ctx}=canvas(512,904);ctx.fillStyle="#38241e";ctx.fillRect(0,0,512,904);
		ctx.fillStyle="#efdbb5";ctx.font="bold 36px serif";ctx.fillText(String(card.strength),24,65);
		const map=texture(value),image=new Image();let disposed=false;
		const cleanup=()=>{disposed=true;image.onload=null;image.onerror=null;image.removeAttribute('src');map.removeEventListener('dispose',cleanup);};
		map.addEventListener('dispose',cleanup);
		image.onload=()=>{if(disposed)return;ctx.drawImage(image,0,0,512,904);map.needsUpdate=true;image.onload=null;image.onerror=null;loaded();};
		image.onerror=()=>{if(disposed)return;ctx.font="24px sans-serif";lines(ctx,cardName(card.id,language),460).forEach((line,i)=>ctx.fillText(line,24,170+i*38));map.needsUpdate=true;loaded();};
		image.src=cardFaceURL(card.id);return map;
	}
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
	const accent = "#b19168";
	ctx.strokeStyle = accent;
	ctx.fillStyle = accent;
	if (!card) {
		drawBackDragon(ctx);
		return texture(value);
	}
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
