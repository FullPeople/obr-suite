import { CAMPFIRE, CLOCK, TENT, MOON, SUN } from "./art";
import { transitionDuration, type TransitionEvent } from "./protocol";

/** Finite local audio only. Autoplay restrictions leave the visual ticks intact. */
function clockTicks(): () => void {
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    void context.resume().catch(() => {});
    for (let n = 0; n < 6; n++) timers.push(setTimeout(() => {
      if (!context || context.state !== "running") return;
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = n % 2 ? 660 : 900;
      gain.gain.setValueAtTime(.025, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .05);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + .055);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }, n * 500));
  } catch {}
  return () => { timers.forEach(clearTimeout); if (context) void context.close().catch(() => {}); context = undefined; };
}

export function mountRestPresentation(
  root: HTMLElement, event: TransitionEvent, lang: "zh" | "en", reduced: boolean, finish: () => void,
) {
  const duration = transitionDuration(event.kind, reduced);
  const stage = document.createElement("section");
  stage.className = "rest-stage " + event.kind + (reduced ? " reduced" : "");
  stage.style.setProperty("--duration", duration + "ms");
  const title = event.kind === "text" ? event.text : event.kind === "short"
    ? (lang === "zh" ? "短休" : "Short rest") : (lang === "zh" ? "长休" : "Long rest");
  stage.setAttribute("aria-label", title);
  const veil = document.createElement("div"); veil.className = "rest-veil";
  stage.append(veil);
  const art = (name: string, source: string, parent: HTMLElement = stage) => {
    const element = document.createElement("div"); element.className = name;
    // Only locally authored constant SVG reaches innerHTML. User text uses textContent.
    element.innerHTML = source; parent.append(element); return element;
  };
  if (event.kind === "long") {
    art("rest-tent", TENT);
    const moonOrbit = document.createElement("div"); moonOrbit.className = "rest-orbit moon-orbit";
    art("rest-moon", MOON, moonOrbit);
    const sunOrbit = document.createElement("div"); sunOrbit.className = "rest-orbit sun-orbit";
    art("rest-sun", SUN, sunOrbit);
    stage.append(moonOrbit, sunOrbit);
  } else {
    art("rest-fire", CAMPFIRE);
    if (event.kind === "short") art("rest-clock", CLOCK);
  }
  const heading = document.createElement("h1");
  heading.className = "rest-heading" + (event.kind === "text" ? " custom" : "");
  heading.textContent = title; stage.append(heading);
  const close = document.createElement("button");
  close.className = "rest-close"; close.textContent = "×";
  close.ariaLabel = lang === "zh" ? "返回地图" : "Return to map";
  stage.append(close); root.append(stage);
  let ended = false, audioStop = () => {};
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const motionChanged = () => { if (motion.matches) { stage.classList.add("reduced"); audioStop(); } };
  motion.addEventListener("change", motionChanged);
  const dispose = () => {
    ended = true; timers.forEach(clearTimeout);
    if (leaveTimer) clearTimeout(leaveTimer);
    audioStop(); document.removeEventListener("keydown", key);
    motion.removeEventListener("change", motionChanged);
    stage.remove();
  };
  const complete = () => { if (ended) return; dispose(); finish(); };
  const leave = () => {
    if (ended || stage.classList.contains("leaving")) return;
    audioStop(); stage.classList.add("leaving");
    leaveTimer = setTimeout(complete, reduced ? 100 : 350);
  };
  const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); leave(); } };
  document.addEventListener("keydown", key); close.addEventListener("click", leave);
  if (event.kind === "short" && !reduced) timers.push(setTimeout(() => { if (!ended && !stage.classList.contains("reduced")) audioStop = clockTicks(); }, 1_400));
  timers.push(setTimeout(complete, Math.max(0, Math.min(duration, event.expiresAt - Date.now()))));
  return { stage, dispose, leave, duration };
}
