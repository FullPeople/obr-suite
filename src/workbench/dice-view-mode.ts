export type DiceViewMode = '2d' | '3d';
export const DICE_VIEW_MODE_KEY = 'obr-suite/dice/view-mode';
export function readDiceViewMode(): DiceViewMode {
  return '2d';
}
export function saveDiceViewMode(value: DiceViewMode): void {
  if (value !== '2d' && value !== '3d') throw Error('无效的骰子显示模式');
  localStorage.setItem(DICE_VIEW_MODE_KEY, '2d');
}
