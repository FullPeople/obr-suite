import OBR, { mock } from './fixtures/workbench-sdk';
import { setupWorkbench } from '../src/workbench/background';
import { ModuleLifecycle } from '../src/utils/moduleLifecycle';
mock.settings = { enabled: { resourceTracker: false } };
mock.resourceStarts = 0;
mock.notifications = [];
OBR.notification.show = async (text?:string) => { mock.notifications.push(text); };
const getRole=OBR.player.getRole;
let firstRoleRead=true;
OBR.player.getRole=async()=>{
  if(!firstRoleRead)return getRole();firstRoleRead=false;
  return new Promise(resolve=>{mock.resolveInitialNoticeRole=()=>resolve('GM');});
};
// Follow the production ordering: workbench infrastructure starts first; the
// legacy module worker can be blocked indefinitely by an earlier module.
setupWorkbench();
const lifecycle = new ModuleLifecycle({
  slowModule: { setup: () => new Promise<void>(() => {}), teardown: async () => {} },
  resourceTracker: { setup: async () => { mock.resourceStarts++; }, teardown: async () => {} },
});
void lifecycle.setDesired({ slowModule: true, resourceTracker: true });
