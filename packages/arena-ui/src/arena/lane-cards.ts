// Phone lane cards (chain-wizard-v2 R8): on a narrow screen the canvas is tiny, so every lane also gets a readable card.
// `laneCards` is pure (no DOM); `LaneCardsView` draws it. Icon plus word for state, never colour alone.
import type { LaneVM, SkelMode } from './model';
import { stateIcon } from './panels';

export interface LaneCard {
  lane: number;
  title: string;
  state: { icon: string; label: string };
  mode: SkelMode;
  now: string;
  percent: number;
  chips: { label: string; state: string }[];
  line: string;
}

export interface CardVM { lanes: readonly LaneVM[]; stages: readonly { id: string; label: string }[] }

export function laneCards(vm: CardVM): LaneCard[] {
  return vm.lanes.map((l) => {
    const stage = vm.stages[l.stageIndex]?.label ?? '';
    const pct = l.ordersTotal > 0 ? Math.round((100 * (l.counts.completed + l.counts.failed + l.counts.parked + l.counts.quarantined)) / l.ordersTotal) : 0;
    return {
      lane: l.lane,
      title: `Lane ${l.lane}: ${l.label || l.tier}`,
      state: stateIcon(l.mode),
      mode: l.mode,
      now: l.order ? `${stage || 'Working'}${l.progressLabel ? ` (${l.progressLabel})` : ''}` : 'Waiting for work',
      percent: Math.max(0, Math.min(100, pct)),
      chips: vm.stages.map((s, i) => ({ label: s.label, state: l.chips[i] ?? 'pending' })),
      line: `Score ${l.score}, done ${l.counts.completed}, failed ${l.counts.failed}${l.counts.repeats ? `, repeats ${l.counts.repeats}` : ''}`,
    };
  });
}

export class LaneCardsView {
  private last = '';
  constructor(private root: HTMLElement, private onOpen: (lane: number) => void) {}

  update(vm: CardVM): void {
    const cards = laneCards(vm);
    const key = JSON.stringify(cards);
    if (key === this.last) return;
    this.last = key;
    this.root.replaceChildren(...cards.map((c) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = `lc lc--${c.mode}`;
      b.setAttribute('aria-label', `${c.title}, ${c.state.label}, ${c.now}. Open the lane log.`);
      b.onclick = () => this.onOpen(c.lane);
      const head = document.createElement('div'); head.className = 'lc-head';
      const t = document.createElement('b'); t.textContent = c.title;
      const s = document.createElement('span'); s.textContent = `${c.state.icon} ${c.state.label}`;
      head.append(t, s);
      const now = document.createElement('div'); now.className = 'lc-now'; now.textContent = c.now;
      const bar = document.createElement('div'); bar.className = 'lc-bar'; bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuenow', String(c.percent));
      const fill = document.createElement('i'); fill.style.width = `${c.percent}%`; bar.append(fill);
      const chips = document.createElement('div'); chips.className = 'lc-chips';
      for (const ch of c.chips) { const e = document.createElement('span'); e.className = `lc-chip lc-chip--${ch.state}`; e.textContent = ch.label; chips.append(e); }
      const line = document.createElement('div'); line.className = 'lc-line'; line.textContent = c.line;
      b.append(head, now, bar, chips, line);
      return b;
    }));
  }
}
