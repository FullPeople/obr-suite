import { FONTS, duration, type TextEffectConfig } from './model';
import './renderer.css';
const element = (name: string, className: string, text?: string) => { const el = document.createElement(name); el.className = className; if (text) el.textContent = text; return el; };
export function renderEffect(root: HTMLElement, c: TextEffectConfig, options: { startsAt?: number; reduced?: boolean; onComplete?: () => void } = {}) {
  root.replaceChildren();
  const stage = element('div', `te-stage te-${c.background} te-position-${c.position}`), background = element('div', 'te-background');
  stage.style.setProperty('--te-color', c.color); stage.style.setProperty('--te-accent', c.accent);
  stage.style.setProperty('--te-bg', c.backgroundColor); stage.style.setProperty('--te-opacity', String(c.opacity));
  stage.style.setProperty('--te-font', FONTS[c.font]); stage.style.setProperty('--te-spacing', `${c.spacing / 100}em`);
  const ornament = element('div', `te-ornament te-${options.reduced ? 'none' : c.decoration}`);
  for (let i = 0; i < 20; i++) { const dot = element('i', 'te-particle'); dot.style.setProperty('--i', String(i)); dot.style.left = `${(i * 47 + 13) % 100}%`; dot.style.top = `${(i * 29 + 19) % 100}%`; ornament.append(dot); }
  const motion = element('div', 'te-motion'), title = element('div', 'te-title'), subtitle = element('div', 'te-subtitle', c.subtitle), body = element('div', 'te-body', c.body);
  motion.style.textAlign = c.align;
  title.style.webkitTextStroke = `${c.outline}px ${c.outlineColor}`;
  title.style.textShadow = `0 0 ${c.glow}px ${c.accent}, 0 2px 8px ${c.outlineColor}`;
  const glyphs = Array.from(c.title).map(letter => element('span', 'te-glyph', letter)); title.append(...glyphs);
  title.hidden = !c.title; subtitle.hidden = !c.subtitle; body.hidden = !c.body;
  motion.append(title, subtitle, body); stage.append(background, ornament, motion); root.append(stage);
  const total = duration(c), animated: Animation[] = [];
  let frame = 0, disposed = false, bodyPages = [c.body], lastPage = -1, bodyGlyphs: HTMLElement[] = [];
  const entrance = options.reduced ? 'fade' : c.motion;
  const subtitleGlyphs = entrance === 'typewriter' ? Array.from(c.subtitle).map(letter => element('span', 'te-glyph', letter)) : [];
  if (subtitleGlyphs.length) subtitle.replaceChildren(...subtitleGlyphs);
  const transforms = { fade: 'none', rise: 'translateY(32px)', left: 'translateX(-12%)', right: 'translateX(12%)', zoom: 'scale(1.22)', typewriter: 'none' };
  const track = (el: HTMLElement, keyframes: Keyframe[], ms: number) => { const animation = el.animate(keyframes, { duration: Math.max(1, ms), fill: 'both', easing: 'linear' }); animation.pause(); animated.push(animation); return animation; };
  const inAt = c.enter / total, outAt = (c.enter + c.hold) / total;
  track(motion, [{ opacity: c.enter ? 0 : 1, transform: transforms[entrance], offset: 0 }, { opacity: 1, transform: 'none', offset: inAt }, { opacity: 1, transform: 'none', offset: outAt }, { opacity: c.exit ? 0 : 1, transform: 'none', offset: 1 }], total);
  track(background, [{ opacity: c.enter ? 0 : c.opacity, offset: 0 }, { opacity: c.opacity, offset: inAt }, { opacity: c.opacity, offset: outAt }, { opacity: 0, offset: 1 }], total);
  if (!options.reduced && c.decoration !== 'none') {
    track(ornament, [{ opacity: 0, transform: 'scale(.85) rotate(-8deg)', offset: 0 }, { opacity: 1, transform: 'scale(1) rotate(0deg)', offset: inAt }, { opacity: 0.6, transform: 'scale(1.2) rotate(8deg)', offset: outAt }, { opacity: 0, transform: 'scale(1.3) rotate(10deg)', offset: 1 }], total);
    if (c.decoration === 'sparks') for (const [i, dot] of Array.from(ornament.children).entries()) track(dot as HTMLElement, [{ transform: 'translateY(20px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 0.8, offset: 0.25 }, { transform: `translateY(${-40 - i * 3}px)`, opacity: 0 }], total);
  }
  const draw = (time: number) => { const t = Math.max(0, Math.min(total, time)); for (const animation of animated) animation.currentTime = t;
    const page = Math.min(bodyPages.length - 1, Math.max(0, Math.floor((t - c.enter) / c.hold * bodyPages.length)));
    if (page !== lastPage) {
      body.textContent = bodyPages[page]; lastPage = page;
      if (entrance === 'typewriter') { bodyGlyphs = Array.from(bodyPages[page]).map(letter => element('span', 'te-glyph', letter)); body.replaceChildren(...bodyGlyphs); }
    }
    if (entrance === 'typewriter') {
      for (const letters of [glyphs, subtitleGlyphs]) letters.forEach((g, i) => { g.style.opacity = t >= (i + 1) / Math.max(1, letters.length) * c.enter ? '1' : '0'; });
      const pageTime = page === 0 ? t : t - c.enter - page * c.hold / bodyPages.length;
      const typingDuration = page === 0 ? c.enter : Math.min(c.enter, c.hold / bodyPages.length * .3);
      bodyGlyphs.forEach((g, i) => { g.style.opacity = pageTime >= (i + 1) / Math.max(1, bodyGlyphs.length) * typingDuration ? '1' : '0'; });
    }
  };
  const layout = () => {
    const width = stage.clientWidth;
    let size = width * c.size / 100, subtitleSize = Math.max(12, Math.min(36, width * .024));
    body.style.fontSize = `${Math.max(14, Math.min(42, width * .028))}px`;
    body.textContent = c.body ? '中' : '';
    for (let i = 0; i < 12; i++) {
      title.style.fontSize = `${size}px`; subtitle.style.fontSize = `${subtitleSize}px`;
      if (motion.scrollHeight <= motion.clientHeight + 1) break;
      size *= .85; subtitleSize *= .9;
    }
    bodyPages = [];
    const letters = Array.from(c.body);
    for (let at = 0; at < letters.length;) {
      let low = 1, high = letters.length - at, fit = 1;
      while (low <= high) { const mid = Math.floor((low + high) / 2); body.textContent = letters.slice(at, at + mid).join('');
        if (motion.scrollHeight <= motion.clientHeight + 1) { fit = mid; low = mid + 1; } else high = mid - 1;
      }
      bodyPages.push(letters.slice(at, at + fit).join('')); at += fit;
    }
    if (!bodyPages.length) bodyPages = [''];
    root.dataset.pages = String(bodyPages.length); lastPage = -1;
    draw(options.startsAt === undefined ? c.enter : Date.now() - options.startsAt);
  };
  layout();
  const resize = new ResizeObserver(layout); resize.observe(stage);
  const dispose = () => { if (disposed) return; disposed = true; resize.disconnect(); cancelAnimationFrame(frame); animated.forEach(a => a.cancel()); if (stage.parentElement === root) stage.remove(); };
  if (options.startsAt === undefined) draw(c.enter);
  else { const tick = () => { if (disposed) return; const elapsed = Date.now() - options.startsAt!; draw(elapsed); stage.style.visibility = elapsed < 0 ? 'hidden' : 'visible'; if (elapsed >= total) { dispose(); options.onComplete?.(); } else frame = requestAnimationFrame(tick); }; tick(); }
  return { dispose };
}
