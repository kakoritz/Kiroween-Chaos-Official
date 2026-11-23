// SH-U1: entry for the Workflow Lab page. Uses window.__hauntLab (SH-C3), installed here from the browser-safe lab engine.
import { installLab, type LabApi } from '../../haunt/src/lab/inpage';
import { PRESETS, presetModel } from '../src/workflow-lab/model';
import { mountWorkflowLab } from '../src/workflow-lab/panel';
import './workflow-lab.css';

const w = window as unknown as { __hauntLab?: LabApi };
if (!w.__hauntLab) installLab(w);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lab = mountWorkflowLab(document.getElementById('workflow-lab')!, (m) => w.__hauntLab!.labRun(m), reduced);
(window as unknown as { __workflowLab?: unknown }).__workflowLab = lab;

// `?preset=inbox&run=1` loads a preset and runs it (used for screenshots and shareable local links).
const q = new URLSearchParams(location.search);
const preset = q.get('preset');
if (preset && PRESETS.some((p) => p.id === preset)) lab.setModel(presetModel(preset), preset);
if (q.get('run') === '1') void lab.run();
