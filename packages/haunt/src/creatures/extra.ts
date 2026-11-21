// The remaining creatures: Banshee (internet outage), Gargoyle (endpoint down), Goblin (429), Imp (500),
// Witch (malformed payload), Mummy (disk full), Werewolf (hazard event), Will-o'-Wisp (driver unreachable).
// Spec: tasks.md H2.3, runtime.md section 12. The three bosses are not part of this slice.
import type { CreaturePlugin } from './plugin';
import { need, providerCreature, type CoreContext } from './core';

/** Extra engine helpers for the data and disk creatures. */
export interface ExtraContext extends CoreContext {
  /** Replaces the intake file content with an unparseable payload. */
  corruptInput?: () => void | Promise<void>;
  /** Makes the next write to the lane output folder fail with a disk-full error. */
  fillDisk?: () => void | Promise<void>;
}

export const banshee = providerCreature('banshee', 'Banshee', 'network', ['internet_outage']);
export const gargoyle = providerCreature('gargoyle', 'Gargoyle', 'network', ['endpoint_down', 'sms_down']);
export const goblin = providerCreature('goblin', 'Goblin', 'http', ['http_429', 'updates_down']);
export const imp = providerCreature('imp', 'Imp', 'http', ['http_500', 'app_down']);
export const werewolf = providerCreature('werewolf', 'Werewolf', 'world', ['hazard_event']);
export const willOWisp = providerCreature('will_o_wisp', "Will-o'-Wisp", 'world', ['driver_unreachable']);

export const scarecrow = providerCreature('scarecrow', 'Scarecrow', 'world', ['wrong_address']);
export const blackCat = providerCreature('black_cat', 'Black Cat', 'world', ['no_answer', 'gated_house']);
export const phantomCar = providerCreature('phantom_car', 'Phantom Car', 'world', ['car_accident']);

export const witch: CreaturePlugin = {
  id: 'witch', label: 'Witch', family: 'data', faults: ['malformed_payload'],
  appliesTo: { stages: ['intake'] },
  async inject(ctx) {
    await need((ctx as ExtraContext).corruptInput, 'corruptInput', 'malformed_payload')();
  },
};

export const mummy: CreaturePlugin = {
  id: 'mummy', label: 'Mummy', family: 'data', faults: ['disk_full'],
  async inject(ctx) {
    await need((ctx as ExtraContext).fillDisk, 'fillDisk', 'disk_full')();
  },
};

export const EXTRA_CREATURES: readonly CreaturePlugin[] = [banshee, gargoyle, goblin, imp, witch, mummy, werewolf, willOWisp, scarecrow, blackCat, phantomCar];
