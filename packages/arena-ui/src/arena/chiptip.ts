// Tooltips for stage chips and the heat strip (PT-U3). Pure lookup over the view model.
import { chipTip, fromLegacy, heatAt, heatTip } from './chips';
import { chipWidth, stationX, type ArenaVM } from './model';
import { laneBoxes } from './scene';

/** Tooltip text for design-space point (x, y), or '' when nothing is there. */
export function chipTipAt(vm: ArenaVM, x: number, y: number, inset = 0): string {
  const boxes = laneBoxes(vm.lanes.length, inset);
  const n = vm.stages.length;
  for (let li = 0; li < boxes.length; li++) {
    const top = boxes[li]!.top + 4;
    const l = vm.lanes[li]!;
    for (let i = 0; i < n; i++) {
      if (Math.abs(x - stationX(i, n)) > chipWidth(n) / 2) continue;
      const label = vm.stages[i]!.label;
      if (y >= top && y <= top + 40) return chipTip(label, l.v2?.[i] ?? fromLegacy(l.chips[i] ?? 'pending', l.attempts[i] ?? 0));
      if (y > top + 40 && y <= top + 52) {
        const h = heatAt(l.heat, l.v2, l.heatFolded, i);
        return heatTip(label, h.issues, h.orders);
      }
    }
  }
  return '';
}
