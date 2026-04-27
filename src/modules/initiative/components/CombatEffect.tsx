import { useEffect, useState } from "preact/compat";

interface Props {
  onComplete: () => void;
  lang: string;
  type: "prepare" | "ambush" | "combat";
}

export function CombatEffect({ onComplete, lang, type }: Props) {
  const [phase, setPhase] = useState<"enter" | "fly" | "exit">("enter");

  const isZh = lang === "zh";

  // Determine text lines based on type
  let line1 = "";
  let line2 = "";
  if (type === "prepare") {
    line1 = isZh ? "战斗" : "COMBAT";
    line2 = isZh ? "准备！" : "PREPARE!";
  } else if (type === "ambush") {
    line1 = isZh ? "突袭！" : "AMBUSH!";
    line2 = "";
  } else {
    line1 = isZh ? "战斗" : "COMBAT";
    line2 = isZh ? "开始！" : "BEGIN!";
  }

  const colorClass = type === "prepare" ? "color-gold" : "color-red";

  useEffect(() => {
    // enter: brief flash, then start flying
    const t1 = setTimeout(() => setPhase("fly"), 50);
    const t2 = setTimeout(() => setPhase("exit"), 1400);
    const t3 = setTimeout(() => onComplete(), 1650);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [onComplete]);

  return (
    <div className={`combat-effect-overlay phase-${phase} ${colorClass}`}>
      <div className="effect-flash" />
      <div className="effect-vignette" />
      <div className="effect-flying-container">
        <div className={`flying-text fly-from-left ${phase === "fly" ? "animate" : ""}`}>
          {line1}
        </div>
        {line2 && (
          <div className={`flying-text fly-from-right ${phase === "fly" ? "animate" : ""}`}>
            {line2}
          </div>
        )}
      </div>
    </div>
  );
}
