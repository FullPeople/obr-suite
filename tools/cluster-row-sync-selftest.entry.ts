import { getState, startSceneSync, refreshFromScene, setState, onStateChange, setLocalLang } from "../src/state";
(window as any).syncState = {getState,startSceneSync,refreshFromScene,setState,onStateChange,setLocalLang};
(window as any).mountNonce = crypto.randomUUID();
if(location.pathname.includes("cluster-row"))await import("../src/cluster-row");
else await import("../src/settings");
