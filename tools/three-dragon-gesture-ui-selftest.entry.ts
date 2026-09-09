import { TableController } from "../extensions/three-dragon-ante/src/game/controller";
import { mountTableUI } from "../extensions/three-dragon-ante/src/game/ui";
import { ControllerRoom } from "./fixtures/three-dragon-controller-room";
import { tableText } from "../extensions/three-dragon-ante/src/game/text";

// Each client has its own document, UI and controller. Only the SDK room boundary
// crosses this same-origin fixture; rules, private crypto and IndexedDB are real.
const world = window as unknown as Record<string, any>;
if (window === window.parent) {
  world.integration = { room: new ControllerRoom(), clients: {}, gestures: [], commands: [], newGameLabel: tableText("newGame", "en") };
  for (const id of ["host", "alice"]) {
    const frame = document.createElement("iframe"); frame.id = id;
    frame.title = id; frame.src = `/client?id=${id}`; document.body.append(frame);
  }
} else {
  const id = new URLSearchParams(location.search).get("id")!;
  const shared = (window.parent as unknown as Record<string, any>).integration;
  let surface: ReturnType<typeof mountTableUI>, open = true;
  const controller = new TableController(view => { if (open) surface?.update(view); }, {
    platform: shared.room.port(id, id), creationSettleMs: 20, retryMs: 100, heartbeatMs: 500,
    onGesture: (seat, gesture) => { shared.gestures.push({ recipient: id, seat, gesture }); if (open) surface?.gesture(seat, gesture); }
  });
  const mount = () => mountTableUI(document.getElementById("app")!, {
    language: "en", gesture: gesture => { if (open) void controller.gesture(gesture); },
    send: async command => {
      shared.commands.push({ player: id, type: command.type });
      if (command.type === "close") {
        // Match the module close order: revoke the panel first, then final clear.
        open = false; await controller.clearGesture(); surface.destroy(); return;
      }
      await controller.command(command);
    }
  });
  surface = mount();
  shared.clients[id] = { controller, get open() { return open; },
    reopen() { open = true; surface = mount(); surface.update(controller.view); },
    async disconnect() { open = false; await controller.stop(); surface.destroy(); shared.room.remove(id); }
  };
  await controller.start(); shared.clients[id].ready = true;
}
