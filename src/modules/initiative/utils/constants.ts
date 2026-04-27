export const PLUGIN_ID = "com.initiative-tracker";
export const METADATA_KEY = `${PLUGIN_ID}/data`;
// Set on an item when the GM explicitly removes it from initiative. Persists
// across reloads so we don't re-prompt for initiative on every scene load.
export const OPTED_OUT_KEY = `${PLUGIN_ID}/opted-out`;
export const COMBAT_STATE_KEY = `${PLUGIN_ID}/combat`;
export const BROADCAST_COMBAT_START = `${PLUGIN_ID}/combat-start`;
export const BROADCAST_COMBAT_END = `${PLUGIN_ID}/combat-end`;
export const BROADCAST_COMBAT_PREPARE = `${PLUGIN_ID}/combat-prepare`;
export const BROADCAST_TURN_CHANGE = `${PLUGIN_ID}/turn-change`;
export const NEW_ITEM_DIALOG_ID = `${PLUGIN_ID}/new-item-dialog`;
export const COMBAT_EFFECT_MODAL_ID = `${PLUGIN_ID}/combat-effect`;
export const BROADCAST_FOCUS = `${PLUGIN_ID}/focus`;
export const BROADCAST_OPEN_PANEL = `${PLUGIN_ID}/open-panel`;
export const BROADCAST_CLOSE_PANEL = `${PLUGIN_ID}/close-panel`;

// Dice+ integration
export const DICE_PLUS_ROLL_REQUEST = "dice-plus/roll-request";
export const DICE_PLUS_ROLL_RESULT = `${PLUGIN_ID}/roll-result`;
export const DICE_PLUS_ROLL_ERROR = `${PLUGIN_ID}/roll-error`;

// Player requests the GM to advance the turn. Only the GM actually writes,
// eliminating the dual-writer race when both the DM presses "next" and the
// active player presses "end turn" at the same time.
export const BROADCAST_END_TURN_REQUEST = `${PLUGIN_ID}/end-turn-request`;
