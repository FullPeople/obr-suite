import OBR from '@owlbear-rodeo/sdk';
import {setupWorkbench} from '../src/workbench/background';
const mock=(window as any).wbMock,update=OBR.scene.items.updateItems.bind(OBR.scene.items);
OBR.scene.items.updateItems=async(...args:any[])=>{if(mock.holdNextProjection){mock.holdNextProjection=false;mock.projectionHeld=true;await new Promise<void>(resolve=>{mock.releaseProjection=()=>{mock.projectionHeld=false;resolve();};});}return (update as any)(...args);};
setupWorkbench();
