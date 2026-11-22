// PT-U7: review card toast beside the door with a customer ghost (ui.md section 7). Pure model plus a small DOM view.
import { normReview, starGlyphs, starText, starTone, type Review } from './lane-popup-model';
import { ratingFor, ratingTone } from './laps-model';

export const REVIEW_CARD_MS = 3000;

export type GhostMood = 'delighted' | 'neutral' | 'angry';

/** 5 stars delighted, 3 to 4 neutral, 1 to 2 angry (ui.md section 7). */
export function ghostMood(stars: number): GhostMood { return stars >= 4.5 ? 'delighted' : stars >= 3 ? 'neutral' : 'angry'; }

export const GHOST_FACE: Record<GhostMood, string> = { delighted: '\u25E0\u203F\u25E0', neutral: '\u2022_\u2022', angry: '\u0CA0_\u0CA0' };

export interface ReviewCardModel {
  lane: number;
  order: string;
  stars: number;
  glyphs: string;
  num: string;
  tone: 'gold' | 'amber' | 'red';
  mood: GhostMood;
  headline: string;
  text: string;
  sub: { label: string; value: number; pct: number }[];
  cancelled: boolean;
}

export function cardOf(lane: number, detail: unknown): ReviewCardModel | null {
  const rv: Review | null = normReview(detail);
  if (!rv) return null;
  const d = (detail && typeof detail === 'object' ? detail : {}) as Record<string, unknown>;
  return {
    lane, order: typeof d.order === 'string' ? d.order : '', stars: rv.stars,
    glyphs: starGlyphs(rv.stars), num: starText(rv.stars), tone: starTone(rv.stars), mood: ghostMood(rv.stars),
    headline: rv.cancelled ? 'Never arrived' : rv.text, text: rv.text,
    sub: rv.cancelled ? [] : rv.sub.map((s) => ({ label: s.label, value: s.value, pct: Math.max(0, Math.min(100, (s.value / 5) * 100)) })),
    cancelled: rv.cancelled,
  };
}

/** Rating title for the label card from the lane's running average (cum stars over cum max, scaled to 5). */
export function laneRatingTitle(st: { sum: number; max: number } | null | undefined): { title: string; tone: 'gold' | 'good' | 'amber' | 'red' } | null {
  if (!st || !(st.max > 0)) return null;
  const title = ratingFor((st.sum / st.max) * 5);
  return { title, tone: ratingTone(title) };
}

/** Pick the view row: latest card per lane replaces the older one. */
export class ReviewCardView {
  private readonly cards = new Map<number, { el: HTMLElement; timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly host: HTMLElement, private readonly place: (lane: number) => { top: number } | null, private readonly ttl = REVIEW_CARD_MS) {}

  onEvent(ev: { type: string; lane?: unknown; detail?: unknown }): void {
    if (ev.type !== 'review' || typeof ev.lane !== 'number') return;
    const m = cardOf(ev.lane, ev.detail);
    if (m) this.show(m);
  }

  show(m: ReviewCardModel): void {
    const old = this.cards.get(m.lane);
    if (old) { clearTimeout(old.timer); old.el.remove(); }
    const box = this.place(m.lane);
    const card = document.createElement('div');
    card.className = `rc rc--${m.tone}`;
    card.setAttribute('role', 'status');
    card.style.top = `${box ? box.top : 80}px`;
    const ghost = document.createElement('span');
    ghost.className = `rc-ghost rc-ghost--${m.mood}`;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.textContent = GHOST_FACE[m.mood];
    const top = document.createElement('div');
    top.className = 'rc-top';
    const stars = document.createElement('b');
    stars.className = 'rc-stars';
    stars.textContent = `${m.glyphs} ${m.num}`;
    top.append(ghost, stars);
    card.append(top);
    if (m.sub.length) {
      const bars = document.createElement('div');
      bars.className = 'rc-bars';
      for (const s of m.sub) {
        const r = document.createElement('div'); r.className = 'rc-bar';
        const lab = document.createElement('span'); lab.textContent = s.label;
        const track = document.createElement('i'); const fill = document.createElement('u'); fill.style.width = `${s.pct}%`; track.append(fill);
        r.append(lab, track);
        bars.append(r);
      }
      card.append(bars);
    }
    if (m.headline) { const q = document.createElement('div'); q.className = 'rc-text'; q.textContent = m.cancelled ? m.headline : `"${m.headline}"`; card.append(q); }
    this.host.append(card);
    const timer = setTimeout(() => { card.remove(); this.cards.delete(m.lane); }, this.ttl);
    this.cards.set(m.lane, { el: card, timer });
  }
}
