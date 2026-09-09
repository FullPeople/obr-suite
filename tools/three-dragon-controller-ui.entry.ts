import { TableController } from "../extensions/three-dragon-ante/src/game/controller";
import { mountTableUI } from "../extensions/three-dragon-ante/src/game/ui";
import { ControllerRoom, MemoryStore } from "./fixtures/three-dragon-controller-room";
import { tableText } from "../extensions/three-dragon-ante/src/game/text";
const world = window as unknown as Record<string, any>;
const room = new ControllerRoom();
const controllers: Record<string, TableController> = {}, surfaces: Record<string, ReturnType<typeof mountTableUI>> = {};
const commands: { player: string; type: string }[] = [];
for (const id of ["host", "alice"]) {
  const root = document.getElementById(id)!;
  // Omitted storage intentionally selects the production IndexedDB store.
  const controller = new TableController(view => surfaces[id]?.update(view), { platform: room.port(id, id), creationSettleMs: 20, retryMs: 100, heartbeatMs: 500 });
  controllers[id] = controller;
  const mount = () => mountTableUI(root, { language: "en", send: async command => { commands.push({ player: id, type: command.type });
    if (command.type === "close") { surfaces[id].destroy(); return; }
    await controller.command(command);
  } });
  surfaces[id] = mount();
  world[`reopen_${id}`] = () => { surfaces[id] = mount(); surfaces[id].update(controller.view); };
}
world.integration = { room, controllers, commands, surfaces, labels: { newGame: tableText("newGame", "en") } };
world.replaceHostWithoutArchive = async () => {
  await controllers.host.stop(); room.remove("host"); surfaces.host.destroy();
  const controller = new TableController(view => surfaces.host?.update(view), { platform: room.port("host", "host-other-browser"), storage: new MemoryStore(), creationSettleMs: 20, retryMs: 100, heartbeatMs: 500 });
  controllers.host = controller;
  surfaces.host = mountTableUI(document.getElementById("host")!, { language: "en", send: command => controller.command(command) });
  await controller.start();
};
await Promise.all(Object.values(controllers).map(controller => controller.start()));
world.integration.ready = true;
