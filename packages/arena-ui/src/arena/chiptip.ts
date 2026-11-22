// Tooltips for stage chips, the heat strip (PT-U3) and the outage ring (TV3-U7). Pure lookup over the view model.
import { chipTip, fromLegacy, heatAt, heatTip } from './chips';
import { chipWidth, stationX, type ArenaVM } from './model';
import { outageAt, outageTip } from './outage';
import { laneBoxes } from './scene';

/** Tooltip text for design-space point (x, y), or '' when nothing is there. `now` is the same clock the reducer uses. */
export function chipTipAt(vm: ArenaVM, x: number, y: number, inset = 0, now: number = typeof performance !== 'undefined' ? performance.now() : 0): string {
  const boxes = laneBoxes(vm.lanes.length, inset);
  const n = vm.stages.length;
  for (let li = 0; li < boxes.length; li++) {
    const top = boxes[li]!.top + 4;
    const l = vm.lanes[li]!;
    for (let i = 0; i < n; i++) {
      const og = outageAt(l, vm.stages[i]!.id);
      // The ring hangs under its chip (centre 61 px below the chip top, radius 18).
      if (og && Math.abs(x - stationX(i, n)) <= 20 && y > top + 40 && y <= top + 82) return outageTip(og, now);
      if (Math.abs(x - stationX(i, n)) > chipWidth(n) / 2) continue;
      const label = vm.stages[i]!.label;
      if (y >= top && y <= top + 40) {
        const base = chipTip(label, l.v2?.[i] ?? fromLegacy(l.chips[i] ?? 'pending', l.attempts[i] ?? 0));
        return og ? `${base} ${outageTip(og, now)}` : base;
      }
      if (y > top + 40 && y <= top + 52) {
        const h = heatAt(l.heat, l.v2, l.heatFolded, i);
        return heatTip(label, h.issues, h.orders);
      }
    }
  }
  return '';
}
