// Time-stop fullscreen overlay iframe.
//
// Two modes, picked from URL params:
//   • default          → animate the cinematic letterbox bars in.
//   • ?cg=<url>[&dm=1]  → "显示为 CG" mode: paint the image fullscreen
//                         (aspect-correct, letterboxed black), and
//                         DO NOT show the cinematic bars. `&dm=1`
//                         drops the field to 0.1 opacity so the DM
//                         can keep working behind the (pass-through)
//                         modal.
const params = new URLSearchParams(location.search);
const cg = params.get("cg");
const isDm = params.get("dm") === "1";

if (cg) {
  const wrap = document.getElementById("cgWrap");
  const img = document.getElementById("cgImg") as HTMLImageElement | null;
  if (wrap && img) {
    img.src = cg;
    wrap.classList.add("on");
    if (isDm) wrap.classList.add("dm");
  }
  // CG mode owns the screen — the cinematic bars stay hidden.
} else {
  requestAnimationFrame(() => {
    setTimeout(() => {
      document.getElementById("top")?.classList.add("show");
      document.getElementById("bottom")?.classList.add("show");
    }, 50);
  });
}
