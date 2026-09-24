// A lamp billboard over every light-emitting item, so the GM can see
// (and click through to select) light sources while the fog tool is up.
// Port of upstream `LightOverlayActor`.

import { buildBillboard, type Item } from "@owlbear-rodeo/sdk";
import { Actor } from "../Actor";
import type { Reconciler } from "../Reconciler";
import { LIGHT_IMAGE } from "../../overlayAssets";
import { LIGHT_OVERLAY_KEY } from "../../ids";

export class LightOverlayActor extends Actor {
  private billboard: string;

  constructor(reconciler: Reconciler, parent: Item) {
    super(reconciler);
    const item = this.parentToBillboard(parent);
    this.billboard = item.id;
    this.reconciler.patcher.addItems(item);
  }

  delete(): void {
    this.reconciler.patcher.deleteItems(this.billboard);
  }

  update(): void {
    // Nothing to do: POSITION / ROTATION / VISIBLE are inherited from
    // the parent (only SCALE and COPY are disabled), so Owlbear keeps
    // the billboard in step on its own. Patching them here would just
    // race the engine mid-drag.
  }

  private parentToBillboard(parent: Item) {
    return buildBillboard(LIGHT_IMAGE, { dpi: 300, offset: { x: 40, y: 40 } })
      .attachedTo(parent.id)
      .position(parent.position)
      .disableAttachmentBehavior(["SCALE", "COPY"])
      .maxViewScale(2)
      .locked(true)
      .visible(parent.visible)
      .metadata({ [LIGHT_OVERLAY_KEY]: true })
      .build();
  }
}
