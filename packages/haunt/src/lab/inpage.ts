// In-page entry for the Workflow Lab: `window.__hauntLab.labRun(model)`. No node imports.
import { labRun, type LabReport } from './engine';
import type { LabModel } from './model';

export interface LabApi {
  labRun(model: LabModel): Promise<LabReport>;
}

export function installLab(target: { __hauntLab?: LabApi }): LabApi {
  const api: LabApi = { labRun };
  target.__hauntLab = api;
  return api;
}
