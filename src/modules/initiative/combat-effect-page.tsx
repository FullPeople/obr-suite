import { render } from "preact";
import { useEffect, useState, useCallback } from "preact/compat";
import OBR from "@owlbear-rodeo/sdk";
import { CombatEffect } from "./components/CombatEffect";
import { COMBAT_EFFECT_MODAL_ID } from "./utils/constants";
import "./styles/effects.css";

function CombatEffectPage() {
  const [show, setShow] = useState(false);

  const params = new URLSearchParams(window.location.search);
  const lang = params.get("lang") || "en";
  const type = (params.get("type") || "combat") as "prepare" | "ambush" | "combat";

  useEffect(() => {
    OBR.onReady(() => setShow(true));
  }, []);

  const handleComplete = useCallback(() => {
    OBR.modal.close(COMBAT_EFFECT_MODAL_ID);
  }, []);

  if (!show) return null;

  return <CombatEffect onComplete={handleComplete} lang={lang} type={type} />;
}

render(<CombatEffectPage />, document.getElementById("root")!);
