// Postmortem and hardening spec text. Spec: engine design.md section 11. Pure functions; no code is ever changed by the reviewer.
import type { Finding } from '../report/builder';

const ev = (f: Finding) => (f.evidenceSeq.length ? f.evidenceSeq.map((s) => `seq ${s}`).join(', ') : 'no seq');

export function countByRule(findings: Finding[]): [string, number][] {
  const m = new Map<string, number>();
  for (const f of findings) m.set(f.rule, (m.get(f.rule) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

export function renderPostmortem(run: string, findings: Finding[]): string {
  const L = [`# Postmortem ${run}`, '', '## Counts per rule', ''];
  if (!findings.length) L.push('No findings.');
  else {
    L.push('| Rule | Findings |', '|---|---|');
    for (const [r, n] of countByRule(findings)) L.push(`| ${r} | ${n} |`);
  }
  L.push('', '## Worst five findings', '');
  if (!findings.length) L.push('None.');
  for (const f of findings.slice(0, 5)) {
    L.push(`- **${f.severity}** ${f.id} (${f.rule}) at ${f.stage || '-'}${f.fault ? '/' + f.fault : ''}: ${f.summary}. Evidence: ${ev(f)}. Suggested part: \`${f.suggestedPart}\`.`);
  }
  L.push('');
  return L.join('\n');
}

export interface HardeningFiles { requirements: string; design: string; tasks: string }

export function renderHardening(run: string, findings: Finding[], botFile = 'apps/haunted-orders/src/bots/rookie.ts'): HardeningFiles {
  const req = [`# Hardening requirements ${run}`, ''];
  if (!findings.length) req.push('No findings. Nothing to harden.');
  findings.forEach((f, i) => req.push(`${i + 1}. THE bot SHALL address ${f.id} (${f.rule}): ${f.summary}. Evidence: ${ev(f)}.`));
  const parts = [...new Set(findings.map((f) => f.suggestedPart))].sort();
  const des = [`# Hardening design ${run}`, '', `Target file: \`${botFile}\`. Parts to adopt from the SDK:`, ''];
  if (!parts.length) des.push('None.');
  for (const p of parts) des.push(`- \`${p}\`: ${findings.filter((f) => f.suggestedPart === p).map((f) => f.id).join(', ')}`);
  des.push('', 'The reviewer proposes; Kiro applies the change. Re-run the sweep afterwards and compare grades.');
  const tasks = [`# Hardening tasks ${run}`, ''];
  for (const f of findings) {
    tasks.push(`- [ ] ${f.id} In \`${botFile}\`, use \`${f.suggestedPart}\` at stage ${f.stage || '-'}. Check: sweep cell ${f.stage || '-'}/${f.fault || '-'} passes. Evidence: ${ev(f)}.`);
  }
  return { requirements: req.join('\n') + '\n', design: des.join('\n') + '\n', tasks: tasks.join('\n') + '\n' };
}
