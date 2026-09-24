import OBR from "@owlbear-rodeo/sdk";
export function onViewportResize(listener: () => void): () => void {
  let alive = true, busy = false, last = "";
  const timer = setInterval(async () => {
    if (!alive || busy) return;
    busy = true;
    try {
      const size = (await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()])).join(":");
      if (alive && last && size !== last) listener();
      last = size;
    } catch {} finally { busy = false; }
  }, 500);
  return () => { alive = false; clearInterval(timer); };
}
