import { mountStatBanner } from "../src/utils/statBanner";
import { patchBubbles } from "../src/utils/statEdit";
import { mountResourcePanel } from "../src/modules/resourceTracker/panel";
import * as storage from "../src/modules/resourceTracker/storage";
import * as tracker from "../src/modules/resourceTracker/index";
import * as session from "../src/modules/resourceTracker/session";
(globalThis as any).__resources = { mountStatBanner, mountResourcePanel, patchBubbles, ...storage, ...tracker, ...session };
