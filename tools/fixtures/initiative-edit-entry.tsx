import { render } from "preact";
import { useInitiative } from "../../src/modules/initiative/hooks/useInitiative";
import { InitiativeList } from "../../src/modules/initiative/components/InitiativeList";
function Probe() {
  const api = useInitiative(); (window as any).editApi = api;
  return <InitiativeList items={api.items} inCombat={false} preparing isGM={api.isGM} playerId="me" diceRolling={false} canEdit={api.canEdit} canShowDice displayMode="final" resolveHpRatio={() => null}
    onFocus={() => {}} onUpdateCount={api.updateCount} onUpdateModifier={api.updateModifier} onRoll={() => {}} lang="en" />;
}
render(<Probe />, document.getElementById("root")!);
(window as any).unmountProbe = () => render(null, document.getElementById("root")!);
