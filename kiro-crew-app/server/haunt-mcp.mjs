import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);

// packages/haunt/src/mcp/server.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync4, readdirSync as readdirSync2, readFileSync as readFileSync5 } from "node:fs";
import { join as join3, resolve as resolve2 } from "node:path";
import { createInterface } from "node:readline";

// packages/haunt/src/config/yaml.ts
var YamlError = class extends Error {
  constructor(message, line) {
    super(`line ${line}: ${message}`);
    this.line = line;
  }
  line;
};
function stripComment(s) {
  let q2 = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q2) {
      if (c === q2) q2 = null;
      continue;
    }
    if (c === '"' || c === "'") q2 = c;
    else if (c === "#" && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}
function splitTop(s) {
  const out = [];
  let depth = 0, q2 = null, cur = "";
  for (const c of s) {
    if (q2) {
      cur += c;
      if (c === q2) q2 = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q2 = c;
      cur += c;
      continue;
    }
    if (c === "[" || c === "{") depth++;
    if (c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}
function findColon(s) {
  let q2 = null, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q2) {
      if (c === q2) q2 = null;
      continue;
    }
    if (c === '"' || c === "'") q2 = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if (c === ":" && depth === 0 && (i === s.length - 1 || /\s/.test(s[i + 1]))) return i;
  }
  return -1;
}
function scalar(raw, no) {
  const s = raw.trim();
  if (s === "" || s === "~" || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s[0] === '"' || s[0] === "'") {
    if (s.length < 2 || s[s.length - 1] !== s[0]) throw new YamlError("unterminated string", no);
    return s.slice(1, -1);
  }
  if (s[0] === "[") {
    if (s[s.length - 1] !== "]") throw new YamlError("unterminated flow list", no);
    return splitTop(s.slice(1, -1)).map((p) => scalar(p, no));
  }
  if (s[0] === "{") {
    if (s[s.length - 1] !== "}") throw new YamlError("unterminated flow map", no);
    const o = {};
    for (const p of splitTop(s.slice(1, -1))) {
      const c = findColon(p);
      if (c < 0) throw new YamlError(`bad flow map entry "${p.trim()}"`, no);
      o[String(scalar(p.slice(0, c), no))] = scalar(p.slice(c + 1), no);
    }
    return o;
  }
  return s;
}
function parseYaml(src) {
  const lines = [];
  src.split(/\r?\n/).forEach((l, i) => {
    if (/\t/.test(l.match(/^\s*/)[0])) throw new YamlError("tabs are not allowed for indentation", i + 1);
    const t = stripComment(l).replace(/\s+$/, "");
    if (t.trim() === "") return;
    lines.push({ indent: t.length - t.trimStart().length, text: t.trim(), no: i + 1 });
  });
  if (lines.length === 0) return null;
  let pos = 0;
  function block(indent) {
    const first = lines[pos];
    return first.text === "-" || first.text.startsWith("- ") ? list(indent) : map(indent);
  }
  function value(rest, parentIndent, no) {
    if (rest !== "") return scalar(rest, no);
    const next = lines[pos];
    if (next && next.indent > parentIndent) return block(next.indent);
    return null;
  }
  function map(indent, inline) {
    const o = {};
    const put = (text2, no, ind) => {
      const c = findColon(text2);
      if (c < 0) throw new YamlError(`expected "key: value", got "${text2}"`, no);
      const key = String(scalar(text2.slice(0, c), no));
      if (key in o) throw new YamlError(`duplicate key "${key}"`, no);
      o[key] = value(text2.slice(c + 1).trim(), ind, no);
    };
    if (inline) put(`${inline.key}:${inline.rest}`, inline.no, indent);
    while (pos < lines.length) {
      const l = lines[pos];
      if (l.indent < indent) break;
      if (l.indent > indent) throw new YamlError("unexpected indentation", l.no);
      if (l.text.startsWith("- ") || l.text === "-") break;
      pos++;
      put(l.text, l.no, indent);
    }
    return o;
  }
  function list(indent) {
    const a = [];
    while (pos < lines.length) {
      const l = lines[pos];
      if (l.indent < indent) break;
      if (l.indent > indent) throw new YamlError("unexpected indentation", l.no);
      if (!(l.text === "-" || l.text.startsWith("- "))) break;
      pos++;
      const rest = l.text.slice(1).trim();
      if (rest === "") {
        const next = lines[pos];
        a.push(next && next.indent > indent ? block(next.indent) : null);
      } else if (findColon(rest) >= 0 && rest[0] !== "[" && rest[0] !== "{" && rest[0] !== '"' && rest[0] !== "'") {
        const c = findColon(rest);
        const itemIndent = indent + (l.text.length - l.text.slice(1).trimStart().length);
        a.push(map(itemIndent, { key: rest.slice(0, c), rest: rest.slice(c + 1), no: l.no }));
      } else {
        a.push(scalar(rest, l.no));
      }
    }
    return a;
  }
  const result = block(lines[0].indent);
  if (pos < lines.length) throw new YamlError("unexpected content", lines[pos].no);
  return result;
}

// packages/haunt/src/blocks/library.ts
var eff = (kind, key, idempotent = "required") => ({ kind, key, idempotent });
var BLOCKS = [
  // input: read something from the outside
  { id: "read_request", label: "Read request", role: "input", about: "Read a job file or request that starts the work.", effects: [], duration: [300, 600] },
  { id: "read_message", label: "Read message", role: "input", about: "Take the next message from a queue or inbox.", effects: [], duration: [300, 600] },
  { id: "browse", label: "Browse", role: "input", about: "Look something up in a catalog before choosing.", effects: [], duration: [300, 700] },
  // work: think or compute, no side effect
  { id: "validate", label: "Validate", role: "work", about: "Check the input is complete and well formed.", effects: [], duration: [400, 900] },
  { id: "transform", label: "Transform", role: "work", about: "Convert or enrich the data.", effects: [], duration: [600, 1200] },
  { id: "decide", label: "Decide", role: "work", about: "Pick a route or answer.", effects: [], duration: [500, 1e3] },
  { id: "render", label: "Render", role: "work", about: "Produce the output the user sees.", effects: [], duration: [600, 1300] },
  { id: "transcode", label: "Transcode", role: "work", about: "Heavy conversion that takes a while.", effects: [], duration: [800, 1400] },
  // effect: change the outside world (each one is a ledger row; the idempotency key decides repeats)
  { id: "create_account", label: "Create account", role: "effect", about: "Sign someone up or log them in.", effects: [eff("account_create", "account:1")], duration: [400, 800] },
  { id: "charge", label: "Take payment", role: "effect", about: "Charge money. A repeat is a double charge.", effects: [eff("charge", "charge:1")], duration: [500, 1e3] },
  { id: "refund", label: "Refund", role: "effect", about: "Give money back.", effects: [eff("refund", "refund:1")], duration: [400, 800] },
  { id: "store_record", label: "Store record", role: "effect", about: "Write a record to the database or storage.", effects: [eff("store", "store:1")], duration: [300, 700] },
  { id: "send_email", label: "Send email", role: "effect", about: "Send a message to a person.", effects: [eff("email", "email:1", "preferred")], duration: [300, 700] },
  { id: "notify", label: "Notify", role: "effect", about: "Push a notification.", effects: [eff("notify", "notify:1", "preferred")], duration: [300, 600] },
  { id: "dispatch_job", label: "Dispatch", role: "effect", about: "Hand work to another service or a courier.", effects: [eff("dispatch", "dispatch:1")], duration: [400, 800] },
  { id: "file_ticket", label: "File ticket", role: "effect", about: "Open a ticket. A repeat is a duplicate ticket.", effects: [eff("ticket", "ticket:1")], duration: [400, 800] },
  { id: "place_order", label: "Place order", role: "effect", about: "Place an order with another party.", effects: [eff("order", "order:1")], duration: [400, 800] },
  // poll: wait for something outside
  { id: "wait_for_callback", label: "Wait for callback", role: "poll", about: "Wait for the other side to answer.", effects: [], duration: [800, 1600] },
  { id: "check_status", label: "Check status", role: "poll", about: "Ask again until a job is done.", effects: [], duration: [600, 1400] },
  { id: "buffer_wait", label: "Buffering", role: "poll", about: "Wait for data to arrive at a steady rate.", effects: [], duration: [800, 1600] },
  // final: close the loop
  { id: "confirm", label: "Confirm", role: "final", about: "Tell the user it is done.", effects: [], duration: [300, 600] },
  { id: "archive", label: "Archive", role: "effect", about: "Keep a copy for later.", effects: [eff("store", "archive:1")], duration: [300, 600] }
];
var BUILTIN_BLOCK_COUNT = BLOCKS.length;
var blockById = (id) => BLOCKS.find((b) => b.id === id);

// packages/haunt/src/config/haunt-config.ts
var ADAPTERS = ["sdk", "proxy", "process"];
var ROLES = ["input", "work", "effect", "poll", "final"];
var IDEM = ["required", "preferred"];
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var isNonEmptyStr = (v) => typeof v === "string" && v.trim() !== "";
function checkUnknown(o, known, path, errors) {
  for (const k of Object.keys(o)) if (!known.includes(k)) errors.push(`${path}${k}: unknown field`);
}
function expandUses(list, errors) {
  const keys = /* @__PURE__ */ new Set();
  const uses = /* @__PURE__ */ new Map();
  return list.map((s, i) => {
    if (!isObj(s) || s.use === void 0) {
      if (isObj(s) && Array.isArray(s.effects)) {
        for (const e of s.effects) if (isObj(e) && isNonEmptyStr(e.key)) keys.add(e.key);
      }
      return s;
    }
    const p = `stages[${i}].`;
    if (!isNonEmptyStr(s.use)) {
      errors.push(`${p}use: expected a block id`);
      return s;
    }
    const b = blockById(s.use);
    if (!b) {
      errors.push(`${p}use: unknown block "${s.use}" (see docs/BLOCKS.md for the list)`);
      return s;
    }
    const n = (uses.get(b.id) ?? 0) + 1;
    uses.set(b.id, n);
    const effects = s.effects !== void 0 ? s.effects : b.effects.map((e, j) => {
      let key = j === 0 && isNonEmptyStr(s.key) ? s.key : e.key;
      for (let t = 2; keys.has(key); t++) key = `${e.key}:${t}`;
      keys.add(key);
      return { kind: e.kind, key, idempotent: e.idempotent };
    });
    if (Array.isArray(s.effects)) {
      for (const e of s.effects) if (isObj(e) && isNonEmptyStr(e.key)) keys.add(e.key);
    }
    const { use: _u, key: _k, ...rest } = s;
    return { ...rest, id: s.id ?? (n === 1 ? b.id : `${b.id}_${n}`), label: s.label ?? b.label, role: s.role ?? b.role, duration: s.duration ?? (b.duration[1] > 0 ? b.duration : void 0), effects, __block: b.id };
  });
}
function validateHauntConfig(raw) {
  const errors = [];
  if (!isObj(raw)) return { ok: false, errors: ["root: expected a mapping"] };
  checkUnknown(raw, ["name", "label", "idPrefix", "creatures", "start", "adapter", "stages", "inputs", "truth", "targets"], "", errors);
  if (!isNonEmptyStr(raw.name)) errors.push("name: required non-empty string");
  if (!isNonEmptyStr(raw.start)) errors.push("start: required non-empty string");
  let adapter = ["sdk"];
  if (raw.adapter !== void 0 && raw.adapter !== null) {
    const list = Array.isArray(raw.adapter) ? raw.adapter : [raw.adapter];
    const bad = list.filter((a) => !ADAPTERS.includes(a));
    if (list.length === 0 || bad.length > 0) errors.push(`adapter: must be one or more of ${ADAPTERS.join(" | ")}`);
    else adapter = list;
  }
  const stages = [];
  if (!Array.isArray(raw.stages) || raw.stages.length === 0) {
    errors.push("stages: required non-empty list");
  } else {
    const seen = /* @__PURE__ */ new Set();
    expandUses(raw.stages, errors).forEach((s, i) => {
      const p = `stages[${i}].`;
      if (!isObj(s)) {
        errors.push(`stages[${i}]: expected a mapping`);
        return;
      }
      checkUnknown(s, ["id", "label", "role", "effects", "duration", "deny", "__block"], p, errors);
      if (!isNonEmptyStr(s.id)) errors.push(`${p}id: required non-empty string`);
      else if (seen.has(s.id)) errors.push(`${p}id: duplicate stage id "${s.id}"`);
      else seen.add(s.id);
      if (!ROLES.includes(s.role)) errors.push(`${p}role: required, one of ${ROLES.join(" | ")}`);
      if (s.label !== void 0 && !isNonEmptyStr(s.label)) errors.push(`${p}label: must be a non-empty string`);
      const effects = [];
      if (s.effects !== void 0 && s.effects !== null) {
        if (!Array.isArray(s.effects)) errors.push(`${p}effects: expected a list`);
        else s.effects.forEach((e, j) => {
          const ep = `${p}effects[${j}].`;
          if (!isObj(e)) {
            errors.push(`${p}effects[${j}]: expected a mapping`);
            return;
          }
          checkUnknown(e, ["kind", "key", "idempotent"], ep, errors);
          if (!isNonEmptyStr(e.kind)) errors.push(`${ep}kind: required non-empty string`);
          if (!IDEM.includes(e.idempotent)) errors.push(`${ep}idempotent: required, one of ${IDEM.join(" | ")}`);
          effects.push({
            kind: String(e.kind),
            key: isNonEmptyStr(e.key) ? e.key : String(e.kind),
            idempotent: e.idempotent
          });
        });
      }
      if (effects.length > 0 && s.role !== "effect") errors.push(`${p}effects: only allowed on role "effect"`);
      let duration;
      if (s.duration !== void 0 && s.duration !== null) {
        const d2 = s.duration;
        if (!Array.isArray(d2) || d2.length !== 2 || !d2.every((n) => typeof n === "number" && n >= 0) || d2[0] > d2[1]) {
          errors.push(`${p}duration: expected [min, max] in ms with 0 <= min <= max`);
        } else duration = [d2[0], d2[1]];
      }
      let deny;
      if (s.deny !== void 0 && s.deny !== null) {
        if (!Array.isArray(s.deny) || !s.deny.every(isNonEmptyStr)) errors.push(`${p}deny: expected a list of fault ids`);
        else deny = s.deny;
      }
      stages.push({
        id: String(s.id),
        label: isNonEmptyStr(s.label) ? s.label : String(s.id),
        role: s.role,
        effects,
        ...duration ? { duration } : {},
        ...deny ? { deny } : {},
        ...typeof s.__block === "string" ? { block: s.__block } : {}
      });
    });
  }
  const creatures = [];
  if (raw.creatures !== void 0 && raw.creatures !== null) {
    if (!Array.isArray(raw.creatures)) errors.push("creatures: expected a list");
    else raw.creatures.forEach((c, i) => {
      const cp = `creatures[${i}].`;
      if (!isObj(c)) {
        errors.push(`creatures[${i}]: expected a mapping`);
        return;
      }
      checkUnknown(c, ["name", "stage", "faults"], cp, errors);
      if (!isNonEmptyStr(c.name)) errors.push(`${cp}name: required non-empty string`);
      if (!Array.isArray(c.faults) || c.faults.length === 0 || !c.faults.every(isNonEmptyStr)) errors.push(`${cp}faults: required list of fault ids`);
      if (c.stage !== void 0 && !stages.some((s) => s.id === c.stage)) errors.push(`${cp}stage: "${String(c.stage)}" is not a stage of this app`);
      if (isNonEmptyStr(c.name) && Array.isArray(c.faults)) creatures.push({ name: c.name, ...isNonEmptyStr(c.stage) ? { stage: c.stage } : {}, faults: c.faults });
    });
  }
  if (raw.inputs !== void 0 && raw.inputs !== null && !isNonEmptyStr(raw.inputs)) errors.push("inputs: must be a non-empty string");
  if (raw.truth !== void 0 && raw.truth !== null) {
    if (!isNonEmptyStr(raw.truth)) errors.push("truth: must be a URL string");
    else if (!/^https?:\/\/\S+$/.test(raw.truth)) errors.push("truth: must be an http(s) URL");
  }
  if (stages.some((s) => s.role === "effect") && !isNonEmptyStr(raw.truth)) {
    errors.push('truth: required when any stage has role "effect"');
  }
  const targets = { recoverMs: 2e4, repeats: 0, concurrency: 8 };
  if (raw.targets !== void 0 && raw.targets !== null) {
    if (!isObj(raw.targets)) errors.push("targets: expected a mapping");
    else {
      const t = raw.targets;
      checkUnknown(t, ["recoverMs", "repeats", "throughputPerMin", "concurrency"], "targets.", errors);
      const num2 = (k, min, int) => {
        const v = t[k];
        if (v === void 0 || v === null) return;
        if (typeof v !== "number" || !Number.isFinite(v) || v < min || int && !Number.isInteger(v)) {
          errors.push(`targets.${k}: expected ${int ? "an integer" : "a number"} >= ${min}`);
        } else targets[k] = v;
      };
      num2("recoverMs", 1, false);
      num2("repeats", 0, true);
      num2("throughputPerMin", 1, false);
      num2("concurrency", 1, true);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    config: {
      name: raw.name,
      ...isNonEmptyStr(raw.label) ? { label: raw.label } : {},
      ...isNonEmptyStr(raw.idPrefix) ? { idPrefix: raw.idPrefix } : {},
      ...creatures.length > 0 ? { creatures } : {},
      start: raw.start,
      adapter,
      stages,
      ...isNonEmptyStr(raw.inputs) ? { inputs: raw.inputs } : {},
      ...isNonEmptyStr(raw.truth) ? { truth: raw.truth } : {},
      targets
    }
  };
}
function parseHauntConfig(source) {
  let raw;
  try {
    raw = parseYaml(source);
  } catch (e) {
    if (e instanceof YamlError) return { ok: false, errors: [`yaml: ${e.message}`] };
    throw e;
  }
  return validateHauntConfig(raw);
}

// packages/haunt/src/config/load.ts
import { readFileSync } from "node:fs";
function loadHauntConfig(path) {
  let src;
  try {
    src = readFileSync(path, "utf8");
  } catch (e) {
    return { ok: false, errors: [`${path}: cannot read file (${e.code ?? "error"})`] };
  }
  return parseHauntConfig(src);
}

// packages/haunt/src/shared/catalog.ts
var TIERS = {
  rookie: { id: "rookie", label: "Rookie", parts: [] },
  retrier: { id: "retrier", label: "Retrier", parts: ["retry"] },
  journaler: { id: "journaler", label: "Journaler", parts: ["retry", "journal"] },
  reconciler: { id: "reconciler", label: "Reconciler", parts: ["retry", "journal", "idempotency"] },
  phoenix: { id: "phoenix", label: "Phoenix", parts: ["retry", "journal", "idempotency", "breaker", "offline_queue"] }
};
var TIER_ORDER = ["rookie", "retrier", "journaler", "reconciler", "phoenix"];
function gradeFor(reliability3) {
  return reliability3 >= 90 ? "A" : reliability3 >= 80 ? "B" : reliability3 >= 65 ? "C" : reliability3 >= 50 ? "D" : "F";
}

// packages/haunt/src/shared/rng.ts
function fnv1a32(text2) {
  let h = 2166136261;
  for (let i = 0; i < text2.length; i++) {
    h ^= text2.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// packages/haunt/src/shared/events.ts
var GLOBAL_TYPES = ["hello", "reset", "wave_start", "wave_end", "boss_warning", "boss_start", "boss_end", "hardening_spec", "fix_applied", "intensity", "round_start", "round_end", "awaiting_next", "tournament_end", "pattern", "spec_written"];
var LANE_TYPES = [
  "lane_ready",
  "order_start",
  "stage_start",
  "stage_progress",
  "stage_done",
  "stage_fail",
  "chaos",
  "chaos_absorbed",
  "process_dead",
  "process_up",
  "recover_start",
  "recover_done",
  "effect",
  "repeat",
  "breaker",
  "order_done",
  "order_failed",
  "order_parked",
  "order_resumed",
  "order_quarantined",
  "order_abandoned",
  "lane_halted",
  "part_added",
  "score",
  "review",
  "decision_needed",
  "decision_made",
  "outage",
  "lane_eliminated",
  "corpse",
  "lesson",
  "case",
  "curse_start",
  "curse_end",
  "curse_response"
];
var ALL_TYPES = [...GLOBAL_TYPES, ...LANE_TYPES];

// packages/haunt/src/chaos/catalog.ts
var INBOX_ORDER = ["login", "ingest", "validate", "dedupe", "triage", "assign", "sla", "notify", "escalate", "resolve", "close"];
var INBOX_EFFECT = ["login", "assign", "notify", "escalate"];
var STREAM_ORDER = ["fetch", "classify", "draft", "reply", "archive"];
var STREAM_EFFECT = ["fetch", "draft", "reply", "archive"];
var EFFECT_STAGES = ["account", "submit", "payment", "confirmation", "receive", "process", "updates", "ship", "transit", ...INBOX_EFFECT, ...STREAM_EFFECT];
var JOURNALED_EFFECT_STAGES = EFFECT_STAGES.filter((s) => s !== "transit");
var ORDERS_ORDER = ["account", "create", "submit", "payment", "confirmation", "receive", "process", "updates", "ship", "transit", "handoff"];
var ALL = [...ORDERS_ORDER, ...INBOX_ORDER, ...STREAM_ORDER];
var CALL_STAGES = ["account", "submit", "payment", "confirmation", "receive", "process", "ship", "login", "assign", "notify", "escalate", ...STREAM_EFFECT];
var ANY_ROLE = ["input", "work", "effect", "poll", "final"];
var EFFECT_OR_POLL = ["effect", "poll"];
var EFFECT_ONLY = ["effect"];
var INPUT_ONLY = ["input"];
var def = (d2) => d2;
var FAULTS2 = [
  def({ id: "crash", creature: "reaper", family: "process", kind: "process", stages: ALL, restartMs: 1e3, count: 1, applies: ANY_ROLE }),
  def({ id: "out_of_memory", creature: "reaper", family: "process", kind: "process", stages: ALL, restartMs: 2500, count: 1, applies: ANY_ROLE }),
  def({ id: "power_outage", creature: "wraith", family: "process", kind: "process", stages: ALL, restartMs: 5e3, count: 1, applies: ANY_ROLE }),
  def({ id: "internet_outage", creature: "banshee", family: "network", kind: "provider", stages: EFFECT_STAGES, forMs: 8e3, applies: EFFECT_OR_POLL }),
  def({ id: "endpoint_down", creature: "gargoyle", family: "network", kind: "provider", stages: EFFECT_STAGES, forMs: 1e4, applies: EFFECT_OR_POLL }),
  def({ id: "timeout", creature: "zombie", family: "network", kind: "provider", stages: CALL_STAGES, count: 1, applies: EFFECT_ONLY }),
  def({ id: "comm_timeout", creature: "zombie", family: "network", kind: "provider", stages: CALL_STAGES, count: 1, applies: EFFECT_ONLY }),
  def({ id: "slow_link", creature: "zombie", family: "network", kind: "provider", stages: EFFECT_STAGES, forMs: 6e3, applies: EFFECT_OR_POLL }),
  def({ id: "http_404", creature: "ghost", family: "http", kind: "provider", stages: CALL_STAGES, count: 2, applies: EFFECT_ONLY }),
  def({ id: "http_429", creature: "goblin", family: "http", kind: "provider", stages: ["payment", "confirmation", "ship", "assign", "notify", "draft", "reply"], count: 3, applies: EFFECT_ONLY }),
  def({ id: "http_500", creature: "imp", family: "http", kind: "provider", stages: EFFECT_STAGES, count: 2, applies: EFFECT_OR_POLL }),
  def({ id: "missing_file", creature: "poltergeist", family: "data", kind: "file", stages: ["create"], forMs: 6e3, applies: INPUT_ONLY }),
  def({ id: "duplicate_request", creature: "doppelganger", family: "data", kind: "file", stages: ["create"], count: 1, applies: INPUT_ONLY }),
  def({ id: "malformed_payload", creature: "witch", family: "data", kind: "file", stages: ["create"], count: 1, applies: INPUT_ONLY }),
  def({ id: "disk_full", creature: "mummy", family: "data", kind: "disk", stages: ALL, count: 1, applies: ANY_ROLE }),
  def({ id: "hazard_event", creature: "werewolf", family: "world", kind: "provider", stages: ["transit"], forMs: 5e3 }),
  def({ id: "sms_down", creature: "gargoyle", family: "network", kind: "provider", stages: ["confirmation"], forMs: 8e3 }),
  def({ id: "app_down", creature: "imp", family: "http", kind: "provider", stages: ["ship"], forMs: 8e3 }),
  def({ id: "updates_down", creature: "goblin", family: "http", kind: "provider", stages: ["updates"], forMs: 8e3 }),
  def({ id: "wrong_address", creature: "scarecrow", family: "world", kind: "provider", stages: ["transit"], forMs: 5e3 }),
  def({ id: "no_answer", creature: "black_cat", family: "world", kind: "provider", stages: ["handoff"], forMs: 3e3 }),
  def({ id: "gated_house", creature: "black_cat", family: "world", kind: "provider", stages: ["handoff"], forMs: 3e3 }),
  def({ id: "order_typo", creature: "prankster", family: "world", kind: "provider", stages: ["create"], forMs: 0 }),
  def({ id: "car_accident", creature: "phantom_car", family: "world", kind: "provider", stages: ["handoff"], forMs: 7e3 }),
  def({ id: "weather", creature: "storm_crow", family: "world", kind: "provider", stages: ["transit"], forMs: 1800 }),
  def({ id: "road_hazard", creature: "pothole_imp", family: "world", kind: "provider", stages: ["transit"], forMs: 4e3 }),
  def({ id: "delay", creature: "scarecrow", family: "world", kind: "provider", stages: ["transit"], forMs: 600 }),
  def({ id: "out_of_gas", creature: "fuel_wraith", family: "world", kind: "provider", stages: ["transit"], forMs: 7e3 }),
  def({ id: "not_on_truck", creature: "lost_parcel_ghoul", family: "world", kind: "provider", stages: ["transit"], forMs: 4e3 }),
  def({ id: "driver_unreachable", creature: "will_o_wisp", family: "world", kind: "provider", stages: ["transit"], forMs: 3e3 }),
  // Ticket Desk faults (packs spec section 4), creatures by name from the art we have. The Python desk applies the `desk` ones itself.
  def({ id: "sla_breach", creature: "banshee", family: "network", kind: "desk", stages: ["sla"], count: 1 }),
  def({ id: "wrong_queue", creature: "poltergeist", family: "data", kind: "desk", stages: ["triage"], count: 1 }),
  def({ id: "duplicate_storm", creature: "zombie", family: "network", kind: "desk", stages: ["dedupe"], count: 1 }),
  def({ id: "sso_expired", creature: "reaper", family: "process", kind: "provider", stages: ["login"], count: 1 }),
  def({ id: "field_mapping_error", creature: "witch", family: "data", kind: "desk", stages: ["validate"], count: 1 }),
  def({ id: "webhook_retry_storm", creature: "doppelganger", family: "data", kind: "desk", stages: ["ingest"], count: 1 }),
  def({ id: "assignee_deleted", creature: "ghost", family: "http", kind: "desk", stages: ["assign"], count: 1 }),
  def({ id: "rate_limited", creature: "goblin", family: "http", kind: "desk", stages: ["assign"], count: 1 })
];
var BY_ID = new Map(FAULTS2.map((f) => [f.id, f]));

// packages/haunt/src/share/badge.ts
var GRADE_COLOURS = {
  A: "#2ea44f",
  B: "#97ca00",
  C: "#dfb317",
  D: "#fe7d37",
  F: "#e05d44"
};
var RESULT_COLOURS = {
  pass: "#2ea44f",
  repeat: "#dfb317",
  recovered_late: "#97ca00",
  fail: "#e05d44",
  halt: "#8b1a1a",
  na: "#444a57"
};
var RESULT_ORDER = ["pass", "recovered_late", "repeat", "fail", "halt", "na"];
var GRADES = ["A", "B", "C", "D", "F"];
var asGrade = (v) => typeof v === "string" && GRADES.includes(v) ? v : "F";
var num = (v) => typeof v === "number" && Number.isFinite(v) ? v : void 0;
var cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function scorecardData(report) {
  const r = report ?? {};
  const grade = asGrade(r.grade);
  const rel = num(r.reliability);
  const reliabilityPct = rel === void 0 ? 0 : Math.round(rel <= 1 ? rel * 100 : rel);
  const score = rel === void 0 ? { A: 95, B: 85, C: 70, D: 55, F: 25 }[grade] : reliabilityPct;
  const cells = {};
  const stages = /* @__PURE__ */ new Set();
  const faults = /* @__PURE__ */ new Set();
  const put = (stage, fault, result) => {
    stages.add(stage);
    faults.add(fault);
    const key = `${stage}\0${fault}`;
    const prev = cells[key];
    const rank = (x) => RESULT_ORDER.indexOf(x === "n/a" ? "na" : x);
    if (prev === void 0 || rank(result) > rank(prev)) cells[key] = result === "n/a" ? "na" : result;
  };
  if (Array.isArray(r.matrix)) {
    for (const m of r.matrix) put(String(m.stage ?? ""), String(m.fault ?? ""), String(m.result ?? "na"));
  }
  if (Array.isArray(r.cells)) {
    for (const c of r.cells) put(String(c.stage ?? ""), String(c.fault ?? c.creature ?? ""), String(c.outcome ?? "na"));
  }
  const rec = r.recovery ?? {};
  const tiers = Array.isArray(r.tiers) ? r.tiers.map((t) => ({ tier: String(t.tier ?? ""), grade: asGrade(t.grade), score: num(t.score) ?? 0 })) : [];
  const sev = { high: 0, medium: 1, low: 2 };
  const findings = Array.isArray(r.findings) ? r.findings.map((f) => ({ s: sev[String(f.severity)] ?? 3, id: String(f.id ?? ""), t: String(f.summary ?? f.rule ?? "") })).sort((a, b) => a.s - b.s || cmp(a.id, b.id)).slice(0, 3).map((f) => f.t) : [];
  const repeatsRaw = Array.isArray(r.repeats) ? r.repeats.reduce((n, x) => n + (num(x.extra) ?? 1), 0) : 0;
  const repeatCells = Array.isArray(r.cells) ? r.cells.filter((c) => Array.isArray(c.repeatedKinds) && c.repeatedKinds.length).length : 0;
  const lostRaw = Array.isArray(r.lost) ? r.lost.length : Array.isArray(r.cells) ? r.cells.filter((c) => c.lost === true).length : 0;
  return {
    app: String(r.app ?? "app"),
    grade,
    score,
    reliabilityPct,
    repeats: repeatsRaw || repeatCells,
    lost: lostRaw,
    recoveryP50: num(rec.p50),
    recoveryP95: num(rec.p95),
    stages: [...stages].sort(cmp),
    faults: [...faults].sort(cmp),
    cells,
    tiers,
    findings
  };
}
function renderBadgeSvg(d2) {
  const label = "Kiroween Chaos";
  const value = `${d2.grade} ${d2.score}`;
  const lw = 6 * label.length + 14;
  const vw = 6.6 * value.length + 14;
  const w = Math.round(lw + vw);
  const colour = GRADE_COLOURS[d2.grade];
  const title = `${label}: ${value}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(title)}">`,
    `<title>${esc(title)}</title>`,
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>`,
    `<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)"><rect width="${Math.round(lw)}" height="20" fill="#555"/><rect x="${Math.round(lw)}" width="${w - Math.round(lw)}" height="20" fill="${colour}"/><rect width="${w}" height="20" fill="url(#s)"/></g>`,
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">`,
    `<text x="${Math.round(lw / 2)}" y="14">${label}</text>`,
    `<text x="${Math.round(lw + (w - lw) / 2)}" y="14" font-weight="bold">${esc(value)}</text>`,
    `</g></svg>`,
    ""
  ].join("\n");
}
var trunc = (s, n) => s.length > n ? `${s.slice(0, n - 1)}\u2026` : s;
function renderScorecardSvg(d2) {
  const colour = GRADE_COLOURS[d2.grade];
  const out = [];
  const t = (x, y, size, fill, s, extra = "") => {
    out.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`);
  };
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" role="img" aria-label="Kiroween Chaos resilience scorecard: ${esc(d2.grade)} ${d2.score}">`);
  out.push(`<title>Kiroween Chaos resilience scorecard</title>`);
  out.push(`<rect width="1200" height="630" fill="#14121c"/><rect x="0" y="0" width="1200" height="8" fill="${colour}"/>`);
  t(48, 70, 34, "#ffffff", "Kiroween Chaos resilience scorecard", 'font-weight="bold"');
  t(48, 104, 20, "#a9a4bd", trunc(d2.app, 60));
  const cx = 220, cy = 270, rad = 100, circ = 2 * Math.PI * rad;
  const dash = Math.max(0, Math.min(100, d2.score)) / 100 * circ;
  out.push(`<circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="#2a2740" stroke-width="22"/>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="${colour}" stroke-width="22" stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`);
  t(cx, cy + 22, 80, colour, d2.grade, 'text-anchor="middle" font-weight="bold"');
  t(cx, cy + 62, 24, "#ffffff", `score ${d2.score}`, 'text-anchor="middle"');
  const stats = [
    ["Reliability", `${d2.reliabilityPct}%`],
    ["Repeats", String(d2.repeats)],
    ["Lost orders", String(d2.lost)],
    ["Recovery p50", d2.recoveryP50 === void 0 ? "n/a" : `${d2.recoveryP50} ms`],
    ["Recovery p95", d2.recoveryP95 === void 0 ? "n/a" : `${d2.recoveryP95} ms`]
  ];
  stats.forEach(([k, v], i) => {
    const x = 400 + i % 3 * 250;
    const y = 190 + Math.floor(i / 3) * 90;
    t(x, y, 16, "#a9a4bd", k);
    t(x, y + 36, 34, "#ffffff", v, 'font-weight="bold"');
  });
  const hx = 400, hy = 380, cw = 28, ch = 14;
  const stagesShown = d2.stages.slice(0, 8);
  const faultsShown = d2.faults.slice(0, 12);
  t(hx, hy - 10, 14, "#a9a4bd", "Coverage: stage by fault");
  stagesShown.forEach((s, si) => {
    faultsShown.forEach((f, fi) => {
      const res = d2.cells[`${s}\0${f}`];
      const fill = res ? RESULT_COLOURS[res] ?? RESULT_COLOURS.na : "#22202f";
      out.push(`<rect x="${hx + fi * (cw + 3)}" y="${hy + si * (ch + 3)}" width="${cw}" height="${ch}" rx="2" fill="${fill}"/>`);
    });
  });
  RESULT_ORDER.forEach((k, i) => {
    out.push(`<rect x="${hx + i * 70}" y="${hy + 8 * 17 + 6}" width="10" height="10" fill="${RESULT_COLOURS[k]}"/>`);
    t(hx + i * 70 + 14, hy + 8 * 17 + 15, 11, "#a9a4bd", k === "recovered_late" ? "late" : k);
  });
  if (d2.tiers.length) {
    const bx = 880, by = 380;
    t(bx, by - 10, 14, "#a9a4bd", "Tiers");
    d2.tiers.slice(0, 5).forEach((r, i) => {
      const y = by + i * 24;
      t(bx, y + 12, 12, "#ffffff", trunc(r.tier, 10));
      out.push(`<rect x="${bx + 80}" y="${y}" width="200" height="14" rx="3" fill="#2a2740"/>`);
      out.push(`<rect x="${bx + 80}" y="${y}" width="${Math.round(2 * Math.max(0, Math.min(100, r.score || { A: 95, B: 85, C: 70, D: 55, F: 25 }[r.grade])))}" height="14" rx="3" fill="${GRADE_COLOURS[r.grade]}"/>`);
      t(bx + 290, y + 12, 12, GRADE_COLOURS[r.grade], r.grade, 'font-weight="bold"');
    });
  }
  const worst = d2.findings.map((f, i) => `${i + 1}. ${trunc(f, 90)}`);
  worst.forEach((line, i) => t(48, 520 + i * 22, 15, "#d8d4ea", line));
  t(48, 612, 14, "#6f6a86", "tested with Kiroween Chaos \xB7 kakoritz/Kiroween-Chaos");
  out.push("</svg>");
  return out.join("\n") + "\n";
}
function renderScorecardHtml(d2) {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>Kiroween Chaos resilience scorecard: ${esc(d2.app)} ${esc(d2.grade)} ${d2.score}</title>`,
    "<style>html,body{margin:0;background:#0b0a10;display:flex;align-items:center;justify-content:center;min-height:100vh}svg{max-width:100%;height:auto}</style>",
    "</head><body>",
    renderScorecardSvg(d2).replace(/\n$/, ""),
    "</body></html>",
    ""
  ].join("\n");
}
function renderBadgeFiles(report) {
  const d2 = scorecardData(report);
  return {
    "haunt-badge.svg": renderBadgeSvg(d2),
    "haunt-scorecard.svg": renderScorecardSvg(d2),
    "haunt-scorecard.html": renderScorecardHtml(d2)
  };
}
var pair = (v) => {
  const o = v ?? {};
  return { before: num(o.before) ?? 0, after: num(o.after) ?? 0 };
};
function improveCardData(report) {
  const r = report ?? {};
  const g = r.grade ?? {};
  const rel = pair(r.reliability), lost = pair(r.lost), rep = pair(r.repeats);
  const patterns = Array.isArray(r.patterns) ? r.patterns.map((p) => ({ signature: String(p.signature ?? p.id ?? ""), status: String(p.status ?? "") })).sort((a, b) => cmp(a.signature, b.signature)) : [];
  const closed = num(r.closed) ?? patterns.filter((p) => p.status === "verified").length;
  const of = num(r.of) ?? patterns.length;
  return {
    closed,
    of,
    summary: typeof r.summary === "string" ? r.summary : `closed ${closed} of ${of} patterns`,
    before: { grade: asGrade(g.before), reliability: rel.before, lost: lost.before, repeats: rep.before },
    after: { grade: asGrade(g.after), reliability: rel.after, lost: lost.after, repeats: rep.after },
    patterns
  };
}
function renderImproveSvg(d2) {
  const out = [];
  const t = (x, y, size, fill, s, extra = "") => {
    out.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`);
  };
  const headline = `closed ${d2.closed} of ${d2.of}, ${d2.before.grade} to ${d2.after.grade}`;
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" role="img" aria-label="Kiroween Chaos improve: ${esc(headline)}">`);
  out.push(`<title>Kiroween Chaos improve: ${esc(headline)}</title>`);
  out.push(`<rect width="1200" height="630" fill="#14121c"/><rect x="0" y="0" width="1200" height="8" fill="${GRADE_COLOURS[d2.after.grade]}"/>`);
  t(48, 70, 34, "#ffffff", "Kiroween Chaos improve loop", 'font-weight="bold"');
  t(48, 104, 22, "#a9a4bd", headline);
  const ring = (cx, label, side) => {
    const colour = GRADE_COLOURS[side.grade];
    const rad = 90, circ = 2 * Math.PI * rad;
    const dash = Math.max(0, Math.min(100, side.reliability)) / 100 * circ;
    out.push(`<circle cx="${cx}" cy="260" r="${rad}" fill="none" stroke="#2a2740" stroke-width="20"/>`);
    out.push(`<circle cx="${cx}" cy="260" r="${rad}" fill="none" stroke="${colour}" stroke-width="20" stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} 260)"/>`);
    t(cx, 285, 76, colour, side.grade, 'text-anchor="middle" font-weight="bold"');
    t(cx, 392, 18, "#a9a4bd", label, 'text-anchor="middle"');
    t(cx, 420, 22, "#ffffff", `${side.reliability}% reliable`, 'text-anchor="middle"');
    t(cx, 448, 16, "#d8d4ea", `lost ${side.lost}, repeats ${side.repeats}`, 'text-anchor="middle"');
  };
  ring(200, "before", d2.before);
  t(430, 280, 64, "#a9a4bd", "\u2192", 'text-anchor="middle"');
  ring(660, "after", d2.after);
  t(880, 170, 15, "#a9a4bd", "Patterns");
  d2.patterns.slice(0, 9).forEach((p, i) => {
    const ok = p.status === "verified";
    out.push(`<rect x="880" y="${186 + i * 30}" width="12" height="12" rx="2" fill="${ok ? "#2ea44f" : p.status === "applied" ? "#dfb317" : "#e05d44"}"/>`);
    t(900, 197 + i * 30, 13, "#d8d4ea", `${trunc(p.signature, 36)} (${p.status})`);
  });
  t(48, 612, 14, "#6f6a86", "tested with Kiroween Chaos \xB7 kakoritz/Kiroween-Chaos");
  out.push("</svg>");
  return out.join("\n") + "\n";
}
function renderImproveFiles(report) {
  const d2 = improveCardData(report);
  const svg = renderImproveSvg(d2);
  return {
    "haunt-improve.svg": svg,
    "haunt-improve.html": [
      "<!doctype html>",
      '<html lang="en"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      `<title>Kiroween Chaos improve: closed ${d2.closed} of ${d2.of}, ${esc(d2.before.grade)} to ${esc(d2.after.grade)}</title>`,
      "<style>html,body{margin:0;background:#0b0a10;display:flex;align-items:center;justify-content:center;min-height:100vh}svg{max-width:100%;height:auto}</style>",
      "</head><body>",
      svg.replace(/\n$/, ""),
      "</body></html>",
      ""
    ].join("\n")
  };
}

// packages/haunt/src/share/write.ts
import { existsSync, mkdirSync, readFileSync as readFileSync2, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
function findRunFile(root, id) {
  for (const p of [resolve(root, id), join(root, ".haunt", "sweeps", id), join(root, ".haunt", "sweeps", `${id}.json`)]) {
    if (p.endsWith(".json") && existsSync(p)) return p;
  }
  return null;
}
function writeBadgeFiles(root, id, outDir) {
  const file = findRunFile(root, id);
  if (!file) return { error: `run not found: ${id}` };
  let report;
  try {
    report = JSON.parse(readFileSync2(file, "utf8"));
  } catch (e) {
    return { error: `unreadable report: ${String(e)}` };
  }
  const dir = resolve(root, outDir);
  mkdirSync(dir, { recursive: true });
  const files = renderBadgeFiles(report);
  const names = Object.keys(files);
  for (const n of names) writeFileSync(join(dir, n), files[n]);
  return { dir, files: names.map((n) => join(dir, n)) };
}
function writeImproveFiles(root, file, outDir) {
  const p = resolve(root, file);
  if (!existsSync(p)) return { error: `improve report not found: ${file}` };
  let report;
  try {
    const j = JSON.parse(readFileSync2(p, "utf8"));
    report = j.report && typeof j.report === "object" ? j.report : j;
  } catch (e) {
    return { error: `unreadable report: ${String(e)}` };
  }
  const dir = resolve(root, outDir);
  mkdirSync(dir, { recursive: true });
  const files = renderImproveFiles(report);
  const names = Object.keys(files);
  for (const n of names) writeFileSync(join(dir, n), files[n]);
  return { dir, files: names.map((n) => join(dir, n)) };
}

// packages/haunt/src/miner/patterns.ts
var THRESHOLDS = { count: 3, lostOrders: 1, downtimeMs: 3e4 };
var patternId = (signature) => `p-${fnv1a32(signature).toString(16).padStart(8, "0")}`;
function qualifies(p) {
  return p.count >= THRESHOLDS.count || p.lostOrders >= THRESHOLDS.lostOrders || p.downtimeMsTotal > THRESHOLDS.downtimeMs;
}
var costOf = (p) => p.downtimeMsTotal + p.lostOrders * 1e4 + p.repeats * 2e3;
var PatternStore = class {
  constructor(file = "") {
    this.file = file;
  }
  file;
  mem = [];
  list() {
    return this.mem;
  }
  save(ps) {
    this.mem = ps;
  }
  get(id) {
    return this.list().find((p) => p.id === id);
  }
  /** Merge one run's mined patterns. The same `runKey` is never counted twice. A verified pattern that shows up again is `new` again (regressed). */
  ingest(mined, runKey) {
    const ps = this.list();
    const changes = [];
    for (const m of mined) {
      const id = patternId(m.signature);
      const cur = ps.find((p) => p.id === id);
      const last = { ...m.firstSeen };
      if (!cur) {
        const p = {
          id,
          signature: m.signature,
          stage: m.stage,
          fault: m.fault,
          consequence: m.consequence,
          shapes: [m.shape],
          count: m.count,
          lanes: [...m.lanes],
          downtimeMsTotal: m.downtimeMs,
          lostOrders: m.lostOrders,
          repeats: m.repeats,
          points: m.points,
          firstSeen: m.firstSeen,
          lastSeen: last,
          status: "new",
          runs: [runKey],
          evidence: [m.evidence],
          solvedBy: m.solvedBy,
          ...m.unknown ? { unknown: true, fingerprint: m.fingerprint } : {}
        };
        ps.push(p);
        changes.push({ pattern: p, kind: "new" });
        continue;
      }
      if (cur.runs.includes(runKey)) continue;
      cur.runs.push(runKey);
      cur.count += m.count;
      cur.downtimeMsTotal += m.downtimeMs;
      cur.lostOrders += m.lostOrders;
      cur.repeats += m.repeats;
      cur.points += m.points;
      cur.lanes = [.../* @__PURE__ */ new Set([...cur.lanes, ...m.lanes])].sort((a, b) => a - b);
      cur.shapes = [.../* @__PURE__ */ new Set([...cur.shapes, m.shape])];
      cur.lastSeen = last;
      cur.evidence = [...cur.evidence, m.evidence].slice(-6);
      cur.solvedBy = [...new Map([...cur.solvedBy, ...m.solvedBy].map((s) => [s.lane, s])).values()];
      let kind = "updated";
      if (cur.status === "verified") {
        cur.status = "new";
        kind = "regressed";
      }
      changes.push({ pattern: cur, kind });
    }
    this.save(ps);
    return changes;
  }
  setStatus(id, status) {
    const ps = this.list();
    const p = ps.find((x) => x.id === id);
    if (!p) return void 0;
    p.status = status;
    this.save(ps);
    return p;
  }
  setStatuses(ids, status) {
    const ps = this.list();
    const hit = ps.filter((p) => ids.includes(p.id));
    for (const p of hit) p.status = status;
    this.save(ps);
    return hit;
  }
  reset() {
    this.save([]);
  }
};

// packages/haunt/src/miner/pattern-store.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname, relative, isAbsolute } from "node:path";
var FilePatternStore = class extends PatternStore {
  list() {
    try {
      const raw = JSON.parse(readFileSync3(this.file, "utf8"));
      return Array.isArray(raw.patterns) ? raw.patterns : [];
    } catch {
      return [];
    }
  }
  save(ps) {
    mkdirSync2(dirname(this.file), { recursive: true });
    writeFileSync2(this.file, JSON.stringify({ version: 1, patterns: ps }, null, 2) + "\n");
  }
};

// packages/haunt/src/miner/specs.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync3, readFileSync as readFileSync4, readdirSync, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join2 } from "node:path";

// packages/haunt/src/sdk/policy.ts
var ACTION_PARTS = {
  retry_backoff: ["retry"],
  journal_replay: ["journal"],
  idempotency_key: ["idempotency"],
  breaker_park: ["breaker", "offline_queue"],
  hold_and_reroute: ["offline_queue"],
  decision: []
};
var ENFORCED_ACTIONS = ["retry_backoff", "idempotency_key", "journal_replay", "breaker_park"];
function policyTakes(parts, action) {
  if (!ENFORCED_ACTIONS.includes(action) || !actionsFor(parts).includes(action)) return false;
  return !(action === "retry_backoff" && parts.includes("breaker"));
}
function actionsFor(parts) {
  const have = new Set(parts);
  return Object.keys(ACTION_PARTS).filter((a) => a !== "decision" && ACTION_PARTS[a].every((p) => have.has(p)));
}

// packages/haunt/src/runner/schedule.ts
var TICK_MS = 1e3;
var ORDER_MS = 7350;

// packages/haunt/src/runner/intensity.ts
var ROW = (level, rate, simultaneous, unknownPct, depth, curses, outageS, continuous = false) => ({ level, rate, simultaneous, unknown: unknownPct / 100, depth, curses, outageMaxMs: outageS * 1e3, continuous });
var INTENSITY_TABLE = [
  ROW(1, 0.3, 1, 0, 1, 0, 5),
  ROW(2, 0.5, 1, 0, 1, 0, 8),
  ROW(3, 0.7, 1, 5, 1, 0, 10),
  ROW(4, 0.9, 1, 10, 2, 1, 12),
  ROW(5, 1.1, 2, 15, 2, 1, 15),
  ROW(6, 1.4, 2, 20, 3, 1, 18),
  ROW(7, 1.7, 2, 25, 3, 2, 22),
  ROW(8, 2, 3, 30, 4, 2, 25),
  ROW(9, 2.5, 3, 35, 4, 2, 28),
  ROW(10, 3, 4, 40, 5, 3, 30),
  ROW(11, 3, Infinity, 50, 5, 5, 30, true)
];
var TICKS_PER_ORDER = ORDER_MS / TICK_MS;

// packages/haunt/src/tournament/rounds.ts
var LANE_TIERS = TIER_ORDER;
var tierOfLane = (lane) => LANE_TIERS[lane - 1];
var POOL = ["crash", "timeout", "http_404", "http_429", "http_500", "endpoint_down", "slow_link"];
var INBOX_POOL = [...POOL, "sso_expired", "field_mapping_error", "webhook_retry_storm", "duplicate_storm", "wrong_queue", "sla_breach", "assignee_deleted", "rate_limited"];

// packages/haunt/src/miner/specs.ts
var DIFF_BUDGET_MAX = 40;
var bot = (lane) => `apps/haunted-orders/src/bots/${tierOfLane(lane)}.ts`;
var botsOf = (p) => [...new Set(p.lanes.map(bot))];
var tiersOf = (p) => [...new Set(p.lanes.map((l) => TIERS[tierOfLane(l)].label))].join(", ") || "the bot";
var faultText = (f) => f.replace(/_/g, " ");
function patchFor(p, ctx) {
  const patch = ownPatch(rawPatchFor(p, ctx), p, ctx);
  if (patch?.action && p.lanes.length > 0) {
    const act = patch.action;
    const has = p.lanes.every((l) => actionsFor(TIERS[tierOfLane(l)].parts).includes(act));
    if (has && !p.lanes.some((l) => policyTakes(TIERS[tierOfLane(l)].parts, act))) return null;
  }
  return patch;
}
function ownPatch(patch, p, ctx) {
  if (!patch || !ctx?.botFile) return patch;
  const files = [...new Set(patch.files.map((f) => f.startsWith("apps/haunted-orders/") || f.startsWith("packages/haunt/src/") ? ctx.botFile : f))];
  return { ...patch, files, test: { ...patch.test, file: `tests/hardening-${p.id}.test.ts` } };
}
function lacking(p, parts) {
  const ls = p.lanes.filter((l) => !parts.every((x) => TIERS[tierOfLane(l)].parts.includes(x)));
  return ls.length ? ls : p.lanes;
}
var botsOfLanes = (ls) => [...new Set(ls.map(bot))];
var tiersOfLanes = (ls) => [...new Set(ls.map((l) => TIERS[tierOfLane(l)].label))].join(", ") || "the bot";
function rawPatchFor(p, ctx) {
  const label = ctx?.stageLabels?.[p.stage];
  const stage = label && label !== p.stage ? `${label} (\`${p.stage}\`)` : p.stage;
  const when = `WHEN ${faultText(p.fault)} hits the ${stage} stage`;
  let bots = botsOf(p);
  let tiers = tiersOf(p);
  const narrow = (parts) => {
    const ls = lacking(p, parts);
    bots = botsOfLanes(ls);
    tiers = tiersOfLanes(ls);
  };
  const probe = (title, how, kind = "property") => ({ kind, title, how, file: `packages/haunt/test/hardening-${p.id}.test.ts` });
  const c = p.consequence;
  if (c === "duplicate_effect") {
    narrow(["idempotency"]);
    return {
      part: "idempotency",
      files: [...bots, "packages/haunt/src/pipeline/pipeline.ts"],
      budgetLines: 6,
      action: "idempotency_key",
      summary: `Add \`idempotency\` to the \`use\` list of ${tiers} so the ${stage} effect is sent with its order key (\`this.key(s, ...)\` in \`Pipeline.stages\` already forwards it).`,
      ears: `${when} and the call is retried, THE bot SHALL send the order's idempotency key so the effect is created at most once.`,
      hypothesis: `${tiers} retries the ${stage} call after ${faultText(p.fault)} without a key, so the provider cannot tell the retry from a new request and writes a second row.`,
      risk: "Low: keys only add a header. A provider that ignores keys behaves as before.",
      rollback: "Remove `idempotency` from the `use` list.",
      test: probe(`no repeated effect at ${stage} under ${p.fault}`, `fast-check: for any seed and a ${p.fault} armed at ${stage}, the provider ledger has one row per (order, kind).`)
    };
  }
  if (c === "order_lost" && ["timeout", "comm_timeout", "slow_link", "http_404", "http_429", "http_500", "endpoint_down", "internet_outage", "sms_down", "app_down", "updates_down"].includes(p.fault)) {
    const haveRetry = p.lanes.every((l) => policyTakes(TIERS[tierOfLane(l)].parts, "retry_backoff"));
    narrow(["retry"]);
    return {
      part: "retry",
      files: haveRetry ? [".haunt/lessons/<lane>.json (haunt.policy overlay)"] : [...bots, "packages/haunt/src/sdk/sdk.ts"],
      budgetLines: haveRetry ? 8 : 5,
      action: "retry_backoff",
      summary: haveRetry ? `Add one \`haunt.policy\` rule \`{stage: "${stage}", fault: "${p.fault}", action: "retry_backoff", backoff: "exp", maxAttempts: 5}\` (a lesson); \`Sdk.call\` already honours it.` : `Add the \`retry\` part to the \`use\` list of ${tiers}, then the policy rule \`{stage: "${stage}", fault: "${p.fault}", action: "retry_backoff"}\` so \`Sdk.call\` backs off instead of failing the order.`,
      ears: `${when}, THE bot SHALL retry the call with exponential backoff (500 ms doubling, up to 5 attempts) before it fails the order.`,
      hypothesis: `${tiers} makes at most three plain retries 500 ms apart, which is shorter than a typical ${faultText(p.fault)} window, so the order is cancelled while the endpoint is only briefly down.`,
      risk: "Low: longer recovery for orders that would have failed anyway; a permanently dead endpoint now takes about 7.5 s longer to give up.",
      rollback: "Delete the policy rule (and the part from the `use` list).",
      test: probe(`order survives ${p.fault} at ${stage}`, `fixture replay: arm ${p.fault} at ${stage} for 3 s on a lane with the change; expect order_done and one row per effect.`, "fixture")
    };
  }
  if (c === "order_lost" && ["crash", "power_outage", "out_of_memory"].includes(p.fault)) {
    narrow(["journal"]);
    return {
      part: "journal",
      files: [...bots, "packages/haunt/src/sdk/sdk.ts"],
      budgetLines: 5,
      action: "journal_replay",
      summary: `Add the \`journal\` part to the \`use\` list of ${tiers} so a restarted process replays the ${stage} stage from the journal (\`Sdk.stage\` already skips journaled stages) instead of losing the order.`,
      ears: `${when} and the process dies, THE bot SHALL resume the order from its journal after the restart instead of cancelling it.`,
      hypothesis: `${tiers} keeps no journal, so a crash at ${stage} forgets what the order already did and the restart cannot finish it.`,
      risk: "Low: the journal is an append-only file per lane; a disk-full fault is already absorbed.",
      rollback: "Remove `journal` from the `use` list.",
      test: probe(`order survives a crash at ${stage}`, `fast-check: for any seed and a ${p.fault} at ${stage} (any crash point), the order ends done with one row per effect.`)
    };
  }
  if (c === "lane_halted" || c === "order_parked" || c === "order_quarantined") {
    narrow(["breaker", "offline_queue"]);
    return {
      part: "offline_queue",
      files: [...bots, "packages/haunt/src/pipeline/pipeline.ts"],
      budgetLines: 10,
      action: "breaker_park",
      summary: `Add \`breaker\` and \`offline_queue\` to the \`use\` list of ${tiers} so a stuck ${stage} parks the order and the lane keeps running (\`Pipeline.inputFailure\` already maps input errors to park or quarantine).`,
      ears: `${when} and the order cannot finish, THE bot SHALL park it in the offline queue and carry on with the next order instead of halting the lane.`,
      hypothesis: `${tiers} has no offline queue, so one order it cannot finish stops the whole lane.`,
      risk: "Medium: parked orders must be resumed; the queue needs a resume trigger.",
      rollback: "Remove the two parts from the `use` list.",
      test: probe(`lane keeps running after ${p.fault} at ${stage}`, `fast-check: for any seed, a ${p.fault} at ${stage} never ends in lane_halted and no order is lost.`)
    };
  }
  if (p.shapes.includes("hang") || c === "stuck") {
    return {
      part: "timeout",
      files: ["packages/haunt/src/bot/runtime.ts"],
      budgetLines: 15,
      summary: `In \`runBot\` (\`call\` helper) cap the ${stage} call at 1500 ms and retry once, so a hung call is not waited out.`,
      ears: `WHEN a call at the ${stage} stage takes longer than its p95, THE bot SHALL time out after 1500 ms and retry once instead of waiting.`,
      hypothesis: `A single call at ${stage} hangs past its normal time and the bot waits for it, which shows as downtime without any error.`,
      risk: "Medium: a slow but healthy call may be cut; a retry can double an effect unless keys are used.",
      rollback: "Restore the previous timeout argument of `call`.",
      test: probe(`a hung ${stage} call is cut short`, `fixture replay: a 15 s stall at ${stage}; expect the order done in under 5 s of downtime.`, "fixture")
    };
  }
  if (c === "retry_storm" || p.shapes.includes("retry_storm") || p.shapes.includes("failure_rate")) {
    narrow(["breaker"]);
    return {
      part: "breaker",
      files: [...bots, "packages/haunt/src/sdk/sdk.ts"],
      budgetLines: 6,
      action: "breaker_park",
      summary: `Add the \`breaker\` part to the \`use\` list of ${tiers} so repeated failures at ${stage} open the circuit and back off (\`Sdk.noteFailure\` counts them).`,
      ears: `WHEN calls at the ${stage} stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.`,
      hypothesis: `${tiers} keeps calling a failing ${stage} endpoint at a fixed pace, so every order pays the full retry cost.`,
      risk: "Low: an open breaker pauses calls for 5 s.",
      rollback: "Remove `breaker` from the `use` list.",
      test: probe(`no retry storm at ${stage}`, `fast-check: under ${p.fault === "errors" ? "a failing endpoint" : p.fault} at ${stage}, calls per order stay under 6.`)
    };
  }
  if (p.shapes.includes("curse")) {
    return {
      part: "wrapper",
      files: ["packages/haunt/src/sdk/sdk.ts"],
      budgetLines: 20,
      summary: `In \`Sdk.call\` treat an unexpected ${faultText(p.fault)} answer as a failure to report (log it, park the order) instead of skipping the step.`,
      ears: `WHEN an endpoint answers with ${faultText(p.fault)} at the ${stage} stage, THE bot SHALL report the failure in the log and park the order instead of skipping the step.`,
      hypothesis: `The bot treats the odd answer as success or ignores it, so the step is skipped silently.`,
      risk: "Medium: stricter handling may park orders that used to pass.",
      rollback: "Revert the `Sdk.call` change.",
      test: probe(`${p.fault} is reported, not swallowed`, `fixture replay: a cursed ${stage} endpoint; expect curse_response class reported or handled, never swallowed.`, "fixture")
    };
  }
  if (c === "outage") {
    narrow(["breaker", "offline_queue"]);
    return {
      part: "offline_queue",
      files: [...bots],
      budgetLines: 8,
      action: "breaker_park",
      summary: `Add \`breaker\` and \`offline_queue\` to the \`use\` list of ${tiers} so orders wait out a ${stage} outage parked.`,
      ears: `WHEN the ${stage} endpoint is down for longer than the retry budget, THE bot SHALL park the order and resume it when the endpoint is back.`,
      hypothesis: `The lane sits through every outage window at ${stage} in the foreground, so downtime equals the window.`,
      risk: "Medium: parked orders must be resumed.",
      rollback: "Remove the two parts from the `use` list.",
      test: probe(`outage at ${stage} parks and resumes`, `fixture replay: a 20 s outage at ${stage}; expect order_parked then order_resumed then order_done.`, "fixture")
    };
  }
  return null;
}
function lessonCover(p, patch) {
  const lanes = patch?.action ? p.lanes.filter((l) => policyTakes(TIERS[tierOfLane(l)].parts, patch.action)) : [];
  return { lanes, solved: p.solvedBy.map((s) => `${TIERS[tierOfLane(s.lane)].label} (${s.mechanism})`) };
}
var sec = (ms) => `${(ms / 1e3).toFixed(1)} s`;
function reliability(orders, lost, repeats) {
  return Math.max(0, Math.round(100 * (orders - lost) / Math.max(1, orders) - 15 * repeats));
}
function renderFixSpec(input) {
  const { runId } = input;
  const plan = input.plan ?? "the same plan and seed";
  const ranked = input.patterns.filter(qualifies).sort((a, b) => b.downtimeMsTotal - a.downtimeMsTotal || b.lostOrders - a.lostOrders || b.repeats - a.repeats || a.signature.localeCompare(b.signature));
  const included = [];
  const refused = [];
  const patches = /* @__PURE__ */ new Map();
  for (const p of ranked) {
    const patch = patchFor(p, input.context);
    if (!patch) refused.push({ pattern: p, reason: "no small patch is known for this shape; it needs a design discussion before any change" });
    else if (patch.budgetLines > DIFF_BUDGET_MAX) refused.push({ pattern: p, reason: `the smallest known patch is ${patch.budgetLines} lines, over the budget of ${DIFF_BUDGET_MAX}` });
    else {
      included.push(p);
      patches.set(p.id, patch);
    }
  }
  const req = [`# Hardening requirements ${runId}`, "", `Run ${runId}. ${included.length} pattern${included.length === 1 ? "" : "s"}, sorted by downtime cost. Each requirement has evidence, a patch (design.md) and a regression test (tasks.md).`, ""];
  const des = [`# Hardening design ${runId}`, "", "The smallest patch for each requirement. Every patch has a diff budget; a change that does not fit its budget is not proposed here.", ""];
  const tasks = [`# Hardening tasks ${runId}`, "", "Ordered by downtime cost. Each task adds a regression test and has an acceptance line. Apply with the review step; nothing here is applied automatically.", ""];
  const rows = [];
  let lostTotal = 0, repeatTotal = 0;
  included.forEach((p, i) => {
    const n = i + 1;
    const patch = patches.get(p.id);
    const cover = lessonCover(p, patch);
    const ev = p.evidence[p.evidence.length - 1] ?? { run: runId, seq: [], journal: [] };
    const refs = [
      `run ${p.runs[0]?.split("#")[0] ?? runId}${ev.round !== void 0 ? ` round ${ev.round}` : ""}`,
      ...p.evidence.flatMap((e) => e.seq).length ? [`events seq ${[...new Set(p.evidence.flatMap((e) => e.seq))].slice(0, 6).join(", ")}`] : [],
      ...p.evidence.flatMap((e) => e.journal).length ? [`journal ${[...new Set(p.evidence.flatMap((e) => e.journal))].slice(0, 3).join(", ")}`] : [],
      ...p.evidence.some((e) => e.report) ? [`report ${[...new Set(p.evidence.map((e) => e.report).filter(Boolean))].slice(0, 2).join(", ")}`] : []
    ];
    const points = p.lostOrders * 300 + p.repeats * 150 + p.points;
    lostTotal += p.lostOrders;
    repeatTotal += p.repeats;
    req.push(
      `## R${n}. ${p.signature}`,
      "",
      patch.ears,
      "",
      `**Evidence:** ${refs.join("; ")}.`,
      "",
      `**Impact:** downtime ${sec(p.downtimeMsTotal)}, ${p.lostOrders} lost ${p.lostOrders === 1 ? "order" : "orders"}, ${p.repeats} repeated ${p.repeats === 1 ? "effect" : "effects"}, about ${points} points; seen ${p.count} times on lane${p.lanes.length === 1 ? "" : "s"} ${p.lanes.join(", ")} (${tiersOf(p)}). Lost orders review as one star.`,
      "",
      `**Root-cause hypothesis:** ${patch.hypothesis}`,
      "",
      `**Covered by lessons:** ${cover.lanes.length ? `lanes ${cover.lanes.join(", ")} can take \`${patch.action}\` as a policy overlay` : "no tier that met it can take this as a policy; it needs the code change"}${cover.solved.length ? `; already solved by ${cover.solved.join(", ")}` : ""}.`,
      ""
    );
    des.push(
      `### D${n} (R${n}) ${p.signature}`,
      "",
      `**Patch:** ${patch.summary}`,
      "",
      `**Files:** ${patch.files.map((f) => `\`${f}\``).join(", ")}`,
      "",
      `**Why:** ${patch.hypothesis}`,
      "",
      `**Risk:** ${patch.risk}`,
      "",
      `**Rollback:** ${patch.rollback}`,
      "",
      `**Diff budget:** under ${patch.budgetLines} lines.`,
      ""
    );
    tasks.push(
      `- [ ] T${n} (R${n}) ${patch.summary}`,
      `  - **Regression test:** ${patch.test.kind === "property" ? "fast-check property" : "fixture replay"} \`${patch.test.title}\` in \`${patch.test.file}\`. ${patch.test.how}`,
      `  - **Acceptance:** rerun ${plan}, expect no \`${p.signature}\`${p.consequence === "duplicate_effect" ? " and no repeated effect" : ""} and downtime under 5 s for it.`,
      ""
    );
    rows.push(`| ${n} | \`${p.signature}\` | ${sec(p.downtimeMsTotal)} | ${p.lostOrders} | ${p.repeats} | ${p.status} | ${cover.lanes.length ? `yes (lanes ${cover.lanes.join(", ")})` : "no"} |`);
  });
  if (!included.length) {
    req.push("No pattern is above the threshold. Nothing to harden.", "");
    des.push("No patches.", "");
    tasks.push("No tasks.", "");
  }
  const orders = input.totals?.orders;
  const nowRel = orders ? reliability(orders, lostTotal, repeatTotal) : void 0;
  const readme = [
    `# Hardening ${runId}`,
    "",
    `${included.length} fix${included.length === 1 ? "" : "es"} for the patterns above the threshold (count 3, any lost order, or over 30 s of downtime), sorted by downtime cost. Written by the pattern miner; Kiro applies a spec with the review step, never automatically.`,
    "",
    "| # | Pattern | Downtime | Lost | Repeats | Status when written | Lessons cover it |",
    "|---|---|---|---|---|---|---|",
    ...rows.length ? rows : ["| - | none | - | - | - | - | - |"],
    "",
    "## Expected grade change",
    "",
    orders && nowRel !== void 0 ? `Over ${orders} orders these patterns cost ${lostTotal} lost orders and ${repeatTotal} repeated effects: reliability ${nowRel} (grade ${gradeFor(nowRel)}) now, about 100 (grade A) once every requirement holds. Rerun ${plan} to verify; a pattern is verified only when the rerun shows it gone.` : `Removing these patterns removes ${lostTotal} lost orders and ${repeatTotal} repeated effects. Rerun ${plan} to verify; a pattern is verified only when the rerun shows it gone.`,
    "",
    "## What lessons already cover",
    "",
    ...included.length ? included.map((p, i) => {
      const c = lessonCover(p, patches.get(p.id));
      return `- R${i + 1}: ${c.lanes.length ? `lanes ${c.lanes.join(", ")} can take the overlay now (no code)` : "needs code"}${c.solved.length ? `; solved by ${c.solved.join(", ")}` : ""}.`;
    }) : ["- Nothing to cover."],
    "",
    ...refused.length ? ["## Not proposed", "", "These patterns are above the threshold, but no small patch is known, so no change is proposed. They need a design discussion first.", "", ...refused.map((r) => `- \`${r.pattern.signature}\`: ${r.reason}.`), ""] : [],
    ...input.reports?.length ? ["## Reports", "", ...input.reports.map((r) => `- ${r}`), ""] : [],
    `Lint: \`npm run haunt -- spec-lint .kiro/specs/hardening-${runId}\``,
    ""
  ].join("\n");
  return { requirements: req.join("\n") + "\n", design: des.join("\n") + "\n", tasks: tasks.join("\n") + "\n", readme, included, refused };
}
var REWRITE = /\brewrit(?:e|es|ing|ten)\b|from scratch|re-?architect|replace the (?:whole|entire)/i;
function sections(text2, head) {
  const out = [];
  const lines = text2.split("\n");
  let cur = null;
  for (const line of lines) {
    const m = head.exec(line);
    if (m) {
      if (cur) out.push({ id: cur.id, n: cur.n, body: cur.body.join("\n") });
      cur = { id: m[0].trim(), n: Number(m[1]), body: [line] };
    } else if (cur) cur.body.push(line);
  }
  if (cur) out.push({ id: cur.id, n: cur.n, body: cur.body.join("\n") });
  return out;
}
function lintSpecDir(dir) {
  const issues = [];
  const add = (file, message, id) => {
    issues.push({ file, message, ...id ? { id } : {} });
  };
  const read = (f) => {
    const p = join2(dir, f);
    return existsSync3(p) ? readFileSync4(p, "utf8") : void 0;
  };
  const reqs = read("requirements.md"), des = read("design.md"), tasks = read("tasks.md");
  if (reqs === void 0) add("requirements.md", "missing");
  if (des === void 0) add("design.md", "missing");
  if (tasks === void 0) add("tasks.md", "missing");
  if (read("README.md") === void 0) add("README.md", "missing");
  if (reqs === void 0 || des === void 0 || tasks === void 0) return { ok: false, issues, requirements: 0 };
  const R = sections(reqs, /^## R(\d+)\./);
  const D = sections(des, /^### D(\d+) /);
  const T = sections(tasks, /^- \[[ xX]\] T(\d+) /);
  for (const r of R) {
    const id = `R${r.n}`;
    if (!/\bWHEN\b[\s\S]*\bSHALL\b/.test(r.body)) add("requirements.md", "is not an EARS requirement (WHEN ... THE bot SHALL ...)", id);
    const ev = /\*\*Evidence:\*\*\s*([^\n]+)/.exec(r.body)?.[1] ?? "";
    if (!ev.trim() || !/\brun\s+\S+|seq\s*\d|journal|report/i.test(ev)) add("requirements.md", "lacks evidence (a run id, event seq, journal line or report link)", id);
    if (!/\*\*Impact:\*\*/.test(r.body)) add("requirements.md", "lacks impact", id);
    if (!/\*\*Root-cause hypothesis:\*\*/.test(r.body)) add("requirements.md", "lacks a root-cause hypothesis", id);
    const d2 = D.find((x) => x.n === r.n);
    if (!d2) add("design.md", "has no patch for this requirement", id);
    else {
      const patch = /\*\*Patch:\*\*\s*([^\n]+)/.exec(d2.body)?.[1]?.trim();
      if (!patch) add("design.md", "patch is empty", id);
      if (!/\*\*Files:\*\*\s*\S/.test(d2.body)) add("design.md", "patch names no file", id);
      if (!/\*\*Risk:\*\*/.test(d2.body) || !/\*\*Rollback:\*\*/.test(d2.body)) add("design.md", "patch lacks risk or rollback", id);
      const b = /\*\*Diff budget:\*\*\s*under\s+(\d+)\s+lines/i.exec(d2.body);
      if (!b) add("design.md", 'patch lacks a diff budget ("under N lines")', id);
      else if (Number(b[1]) > DIFF_BUDGET_MAX) add("design.md", `diff budget ${b[1]} is over ${DIFF_BUDGET_MAX} lines: this is a rewrite, not a patch`, id);
    }
    const t = T.find((x) => x.n === r.n);
    if (!t) add("tasks.md", "has no task for this requirement", id);
    else {
      if (!/\*\*Regression test:\*\*\s*\S/.test(t.body)) add("tasks.md", "task lacks a regression test", id);
      if (!/\*\*Acceptance:\*\*\s*\S/.test(t.body)) add("tasks.md", "task lacks an acceptance line", id);
    }
  }
  for (const d2 of D) if (!R.some((r) => r.n === d2.n)) add("design.md", "patch has no requirement", `D${d2.n}`);
  for (const t of T) {
    if (!R.some((r) => r.n === t.n)) add("tasks.md", "task has no requirement", `T${t.n}`);
    if (REWRITE.test(t.body)) add("tasks.md", "a task says rewrite: only small patches are allowed", `T${t.n}`);
  }
  for (const d2 of D) if (REWRITE.test(d2.body)) add("design.md", "a patch says rewrite: only small patches are allowed", `D${d2.n}`);
  return { ok: issues.length === 0, issues, requirements: R.length };
}
function writeFixSpec(specsDir, input) {
  if (!/^[A-Za-z0-9._-]+$/.test(input.runId) || input.runId.startsWith(".")) throw new Error(`unsafe run id: ${input.runId}`);
  const spec = renderFixSpec(input);
  const dir = join2(specsDir, `hardening-${input.runId}`);
  mkdirSync3(dir, { recursive: true });
  const files = [["requirements.md", spec.requirements], ["design.md", spec.design], ["tasks.md", spec.tasks], ["README.md", spec.readme]];
  for (const [f, text2] of files) writeFileSync3(join2(dir, f), text2);
  return { dir, files: files.map(([f]) => join2(dir, f)), included: spec.included, refused: spec.refused, lint: lintSpecDir(dir) };
}
function listSpecs(specsDir) {
  return existsSync3(specsDir) ? readdirSync(specsDir).filter((n) => /^hardening-[A-Za-z0-9._-]+$/.test(n)).sort() : [];
}

// packages/haunt/src/reviewer/rules.ts
var d = (e) => e.detail ?? {};
var seqOf = (e) => e.seq ?? 0;
function p95(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}
function isTransient(e) {
  const x = d(e);
  const status = Number(x.status);
  const text2 = `${x.error ?? ""} ${x.fault ?? ""}`.toLowerCase();
  return status === 429 || status >= 500 || /429|5\d\d|drop|reset|timeout/.test(text2);
}
function reviewEvents(events, opts = {}) {
  const evs = [...events].sort((a, b) => seqOf(a) - seqOf(b));
  const recoverTarget = opts.recoverMs ?? 2e4;
  const inputStages = opts.inputStages ?? ["create", "intake", "fetch"];
  const out = [];
  const add = (rule, severity, e, fault, summary, seqs, part) => out.push({ rule, severity, stage: e.stage ?? "", fault, summary, evidenceSeq: [...new Set(seqs)].sort((a, b) => a - b), suggestedPart: part });
  for (const e of evs.filter((x) => x.type === "repeat")) {
    const prior = [...evs].reverse().find((x) => x.type === "chaos" && x.lane === e.lane && seqOf(x) < seqOf(e));
    const fault = String(d(e).fault ?? d(prior ?? e).fault ?? "");
    add("R1", "high", e, fault, `Side effect ${d(e).kind ?? "?"} repeated on order ${e.order ?? "?"} at stage ${e.stage ?? "?"}`, [seqOf(e), ...prior ? [seqOf(prior)] : []], "idempotency");
  }
  const failedOrders = evs.filter((x) => x.type === "order_failed");
  for (const f of evs.filter((x) => x.type === "stage_fail" && d(x).retryable === true && !d(x).degraded)) {
    const end = failedOrders.find((o) => o.lane === f.lane && o.order === f.order && seqOf(o) > seqOf(f));
    if (end) add("R2", "medium", f, String(d(f).error ?? ""), `Transient error at ${f.stage ?? "?"} killed order ${f.order ?? "?"}`, [seqOf(f), seqOf(end)], "retry");
  }
  const groups = /* @__PURE__ */ new Map();
  for (const f of evs.filter((x) => x.type === "stage_fail" && isTransient(x))) {
    const k = `${f.lane ?? ""}|${f.order ?? ""}|${f.stage ?? ""}`;
    groups.set(k, [...groups.get(k) ?? [], f]);
  }
  for (const g of [...groups.values()].filter((x) => x.length >= 3)) {
    add("R3", "medium", g[0], String(d(g[0]).error ?? ""), `${g.length} transient failures at ${g[0].stage ?? "?"} for order ${g[0].order ?? "?"}`, g.map(seqOf), "breaker");
  }
  for (const e of evs.filter((x) => x.type === "lane_halted")) {
    add("R4", "high", e, String(d(e).error ?? d(e).reason ?? ""), `Lane ${e.lane ?? "?"} halted on an unhandled error`, [seqOf(e)], "offline_queue");
  }
  for (const o of failedOrders) {
    const fails = evs.filter((x) => x.type === "stage_fail" && x.lane === o.lane && x.order === o.order && seqOf(x) < seqOf(o));
    const enoent = [o, ...fails].filter((x) => /ENOENT/.test(JSON.stringify(d(x))));
    const atInput = inputStages.includes(o.stage ?? "") || enoent.some((x) => inputStages.includes(x.stage ?? ""));
    if (enoent.length && atInput) add("R5", "medium", enoent[0], "missing_file", `Order ${o.order ?? "?"} failed on a missing input file`, [...enoent.map(seqOf), seqOf(o)], "offline_queue");
  }
  const rec = evs.filter((x) => x.type === "recover_done" && Number.isFinite(Number(d(x).ms)));
  const p = p95(rec.map((x) => Number(d(x).ms)));
  if (rec.length && p > recoverTarget) {
    const slow = rec.filter((x) => Number(d(x).ms) > recoverTarget);
    add("R6", "medium", slow[0] ?? rec[0], "", `Recovery p95 ${p} ms is above the ${recoverTarget} ms target`, (slow.length ? slow : rec).map(seqOf), "journal");
  }
  if (opts.journal || opts.ledger) {
    const count = (xs = []) => {
      const m = /* @__PURE__ */ new Map();
      for (const x of xs) m.set(`${x.order}|${x.kind}`, (m.get(`${x.order}|${x.kind}`) ?? 0) + 1);
      return m;
    };
    const j = count(opts.journal);
    const l = count(opts.ledger);
    for (const k of [.../* @__PURE__ */ new Set([...j.keys(), ...l.keys()])].sort()) {
      const rows = l.get(k) ?? 0;
      if (j.has(k) && rows === 0 || rows > 1 || opts.journal && opts.ledger && !j.has(k) && rows > 0) {
        const [order, kind] = k.split("|");
        const ev = evs.find((x) => x.order === order && (x.type === "effect" || x.type === "repeat"));
        add("R7", "high", { stage: ev?.stage }, "", `Journal and ledger disagree for ${kind} on order ${order}: ${rows} ledger row(s)`, ev ? [seqOf(ev)] : [], "idempotency");
      }
    }
  }
  for (const c of evs.filter((x) => x.type === "chaos" && Number(d(x).depth) >= 3)) {
    const end = evs.find((x) => (x.type === "order_failed" || x.type === "lane_halted") && x.lane === c.lane && seqOf(x) > seqOf(c));
    if (end) add("R8", "medium", c, String(d(c).fault ?? ""), `Nested depth ${d(c).depth} died on lane ${c.lane ?? "?"}`, [seqOf(c), seqOf(end)], "review recovery code");
  }
  const rank = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0) || (a.evidenceSeq[0] ?? 0) - (b.evidenceSeq[0] ?? 0));
  return out.map((f, i) => ({ id: `F${i + 1}`, ...f }));
}

// packages/haunt/src/score/grade.ts
var ORDER = ["A", "B", "C", "D", "F"];
function gradeFromScore(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 65) return "C";
  if (score >= 50) return "D";
  return "F";
}
function capAt(g, cap) {
  return ORDER.indexOf(g) < ORDER.indexOf(cap) ? cap : g;
}
function reliability2(i) {
  if (i.orders <= 0) return 0;
  const base = 100 * (i.clean + 0.5 * i.parkedResumed + 0.5 * i.quarantined) / i.orders;
  return Math.max(0, base - 15 * i.extraRows);
}
function gradeOf(i) {
  const r = reliability2(i);
  let g = gradeFromScore(r);
  if (i.chargeRepeated) g = capAt(g, "C");
  if (i.halted || (i.lostOrders ?? 0) > 0) g = capAt(g, "D");
  return { reliability: r, grade: g };
}

// packages/haunt/src/sweep/matrix.ts
var cellColumn = (c) => c.column ?? c.creature;
function buildMatrix(plan, outcomes = {}) {
  const totals = { pass: 0, repeat: 0, recovered_late: 0, fail: 0, halt: 0, "n/a": 0, pending: 0 };
  const applicable = new Set(plan.cells.map((c) => `${c.stage}/${cellColumn(c)}`));
  const rows = {};
  for (const s of plan.stages) {
    rows[s] = {};
    for (const c of plan.creatures) {
      const key = `${s}/${c}`;
      const st = !applicable.has(key) ? "n/a" : outcomes[key] ?? "pending";
      rows[s][c] = st;
      totals[st]++;
    }
  }
  return { stages: plan.stages, creatures: plan.creatures, rows, totals };
}

// packages/haunt/src/sweep/executor.ts
function cellSeed(seed, index) {
  return Math.imul(seed >>> 0, 2654435761) + Math.imul(index + 1, 40503) >>> 0;
}
function gradeSweep(matrix, cells = []) {
  const t = matrix.totals;
  const orders = t.pass + t.repeat + t.recovered_late + t.fail + t.halt;
  return gradeOf({
    orders,
    clean: t.pass + t.recovered_late,
    parkedResumed: 0,
    quarantined: 0,
    extraRows: t.repeat,
    chargeRepeated: cells.some((c) => c.repeatedKinds?.includes("charge")),
    halted: t.halt > 0,
    lostOrders: cells.filter((c) => c.lost).length
  });
}
async function runSweep(plan, runCell, seed = 1) {
  const cells = [];
  const outcomes = {};
  for (let i = 0; i < plan.cells.length; i++) {
    const cell = plan.cells[i];
    let outcome;
    let detail = {};
    let error;
    try {
      const r = await runCell(cell, cellSeed(seed, i));
      if (typeof r === "string") outcome = r;
      else {
        outcome = r.outcome;
        detail = r;
      }
    } catch (e) {
      outcome = "fail";
      error = e instanceof Error ? e.message : String(e);
    }
    outcomes[`${cell.stage}/${cellColumn(cell)}`] = outcome;
    cells.push({
      ...cell,
      outcome,
      ...detail.repeatedKinds?.length ? { repeatedKinds: detail.repeatedKinds } : {},
      ...detail.lost ? { lost: true } : {},
      ...error ? { error } : {}
    });
  }
  const matrix = buildMatrix(plan, outcomes);
  const { reliability: reliability3, grade } = gradeSweep(matrix, cells);
  return { seed, matrix, cells, reliability: reliability3, grade };
}

// packages/haunt/src/packs/embedded.ts
var EMBEDDED_PACKS = {
  "streaming": '# Streaming service pack. Model-based demo: results come from rules over declared protections, not real code.\nid: streaming\ntitle: Haunted Stream\nmodelBased: true\nstages:\n  - { id: login, label: Account or login, kind: effect, effects: [{ kind: session, keyed: true }] }\n  - { id: profile, label: Profile pick, kind: work }\n  - { id: browse, label: Browse, kind: input }\n  - { id: title_select, label: Title select, kind: work }\n  - { id: entitlement, label: Entitlement check, kind: effect, effects: [{ kind: purchase, keyed: true }] }\n  - { id: license, label: License or DRM, kind: effect, effects: [{ kind: license, keyed: true }] }\n  - { id: start_stream, label: Start stream, kind: effect, effects: [{ kind: playback, keyed: true }] }\n  - { id: buffering, label: Buffering and bitrate, kind: poll }\n  - { id: render, label: Render, kind: work }\n  - { id: ads, label: Ads and pause or resume, kind: effect, effects: [{ kind: ad_impression, keyed: true }] }\n  - { id: finish, label: Finish and history, kind: effect, effects: [{ kind: history, keyed: true }] }\nledger:\n  - { id: sessions }\n  - { id: entitlements }\n  - { id: playbacks }\n  - { id: history }\nfaults:\n  - { id: buffering, stage: buffering, creature: Buffer Wraith, art: wraith, sprite: buffer_wraith, mode: stall, behavior: "Lower the bitrate, prefetch, do not restart the stream" }\n  - { id: cdn_timeout, stage: start_stream, creature: CDN Kraken, art: zombie, sprite: cdn_kraken, mode: timeout, behavior: "Failover to a second CDN, circuit breaker" }\n  - { id: drm_denied, stage: license, creature: DRM Gatekeeper, art: ghost, sprite: drm_gatekeeper, mode: status, behavior: "Refresh the token once, then show a clear message" }\n  - { id: render_fail, stage: render, creature: Render Gremlin, art: imp, sprite: render_gremlin, mode: crash, behavior: "Restart the player, keep the position" }\n  - { id: remote_server_down, stage: any, creature: Cloud Banshee, art: banshee, sprite: cloud_banshee, mode: outage, behavior: "Offline queue of watch events, resume later" }\n  - { id: region_lock, stage: entitlement, creature: Region Warden, art: goblin, sprite: region_ghost, mode: status, behavior: "Clear message; no retry storm" }\n  - { id: double_play, stage: start_stream, creature: Doppelganger, art: doppelganger, mode: duplicate, behavior: "Idempotent session, one stream per account" }\n  - { id: watch_history_dup, stage: finish, creature: Poltergeist, art: poltergeist, mode: duplicate, behavior: "Idempotency key on the history write" }\n  - { id: token_expired, stage: any, creature: Reaper, art: reaper, mode: expire, behavior: "Refresh token, do not duplicate the purchase" }\ncurses:\n  - { id: cursed_404, endpoint: catalog, stage: browse, fault: http_404 }\n  - { id: cursed_manifest, endpoint: manifest, stage: buffering, fault: http_500 }\nreviews:\n  label: Viewer rating\n  subscores: [startup_time, buffering, render, ads, ease]\n  stages:\n    startup_time: [login, entitlement, license, start_stream]\n    buffering: [buffering]\n    render: [render]\n    ads: [ads]\n    ease: [profile, browse, title_select, finish]\nbosses:\n  - { id: cdn_kraken, label: Kraken, hits: [start_stream, buffering, render], story: "CDN plus buffering plus render in one night" }\n  - { id: server_lich, label: Server Lich, hits: [login, entitlement, license, start_stream, finish], story: "The whole backend down for 30 s" }\ntiers:\n  retry: "Retry the manifest and segment fetches with backoff"\n  journal: "Remember the playback position and the session across a crash"\n  idempotency: "One stream per account and one history write per play (keys), so a retry never double-streams or re-buys"\n  breaker: "Fail over to a second CDN after a few failures instead of hammering the first"\n  offline_queue: "Queue watch events while the backend is down and resume later"\n',
  "ticketing": '# Ticket desk pack (data only). Model-based; the runnable app is apps/haunted-inbox (PK-C3).\nid: ticketing\ntitle: Haunted Desk\nmodelBased: true\nstages:\n  - { id: login, label: Login or SSO, kind: effect, effects: [{ kind: session, keyed: true }] }\n  - { id: create, label: Create or ingest request, kind: input }\n  - { id: validate, label: Validate and enrich, kind: work }\n  - { id: dedupe, label: Deduplicate, kind: work }\n  - { id: triage, label: Triage and classify, kind: work }\n  - { id: assign, label: Assign, kind: effect, effects: [{ kind: assignment, keyed: true }] }\n  - { id: sla, label: SLA timer, kind: poll }\n  - { id: notify, label: Notify, kind: effect, effects: [{ kind: notice, keyed: true }] }\n  - { id: escalate, label: Escalate or update, kind: effect, effects: [{ kind: escalation, keyed: true }] }\n  - { id: resolve, label: Resolve, kind: effect, effects: [{ kind: resolution, keyed: true }] }\n  - { id: close, label: Close and satisfaction survey, kind: final }\nledger:\n  - { id: tickets }\n  - { id: assignments }\n  - { id: notices }\nfaults:\n  - { id: webhook_retry_storm, stage: create, creature: Doppelganger, art: doppelganger, mode: duplicate, behavior: "Dedupe on external id; one ticket" }\n  - { id: field_mapping_error, stage: validate, creature: Witch, art: witch, mode: corrupt, behavior: "Park, report the field, do not drop the ticket" }\n  - { id: rate_limited, stage: assign, creature: Goblin, art: goblin, mode: status, behavior: "Honour Retry-After, queue" }\n  - { id: assignee_deleted, stage: assign, creature: Ghost, art: ghost, mode: status, behavior: "Reassign to the queue owner" }\n  - { id: sla_breach, stage: sla, creature: Banshee, art: banshee, mode: outage, behavior: "Escalate once, not every minute" }\n  - { id: duplicate_storm, stage: dedupe, creature: Zombie horde, art: zombie, mode: duplicate, behavior: "One master ticket, children linked" }\n  - { id: wrong_queue, stage: triage, creature: Poltergeist, art: poltergeist, mode: misroute, behavior: "Reclassify with the audit trail" }\n  - { id: sso_expired, stage: login, creature: Reaper, art: reaper, mode: expire, behavior: "Refresh, never create a second account" }\n  - { id: notify_down, stage: notify, creature: Banshee Queen, art: wraith, mode: outage, behavior: "Retry later; a missed notice is logged, not lost" }\ncurses:\n  - { id: cursed_tracker, endpoint: tracker, stage: assign, fault: http_429 }\n  - { id: cursed_directory, endpoint: directory, stage: login, fault: http_500 }\nreviews:\n  label: Requester CSAT\n  subscores: [first_response, resolution_time, reassignments, sla, ease]\n  stages:\n    first_response: [create, validate, triage, notify]\n    resolution_time: [escalate, resolve]\n    reassignments: [assign]\n    sla: [sla]\n    ease: [login, dedupe, close]\nbosses:\n  - { id: queue_lich, label: Queue Lich, hits: [create, assign, notify], story: "Tracker down while mail floods in" }\ntiers:\n  retry: "Retry tracker calls honouring Retry-After"\n  journal: "Audit trail of every ticket step, replayed after a crash"\n  idempotency: "Idempotency key is the external ticket id: one ticket, one notice"\n  breaker: "Stop calling a failing tracker and probe before resuming"\n  offline_queue: "Park requests and notices while a tracker is down"\n'
};

// packages/haunt/src/packs/streaming.ts
var STREAMING_PACK_YAML = EMBEDDED_PACKS.streaming;

// packages/haunt/src/packs/pack.ts
var PACK_TIERS = {
  rookie: {},
  retrier: { retry: true },
  journaler: { retry: true, journal: true },
  reconciler: { retry: true, journal: true, idempotency: true },
  phoenix: { retry: true, journal: true, idempotency: true, breaker: true, offline_queue: true }
};
var ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
var isStr = (v) => typeof v === "string" && v.length > 0;
var isObj2 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function stagesOf(r) {
  return r.stages.map((s) => ({ id: s.id, label: s.label, role: s.kind, ...s.effects ? { effects: s.effects.map((e) => ({ kind: e.kind, keyed: e.keyed })) } : {} }));
}
function validatePack(raw) {
  const errs = [];
  if (!isObj2(raw)) return ["pack: expected a map"];
  if (!isStr(raw.id) || !/^[a-z0-9][a-z0-9_-]*$/.test(raw.id)) errs.push("id: lowercase letters, digits, dash or underscore");
  if (!isStr(raw.title)) errs.push("title: required text");
  if (!Array.isArray(raw.stages) || raw.stages.length === 0) {
    errs.push("stages: need at least one stage");
    return errs;
  }
  const ids = /* @__PURE__ */ new Set();
  raw.stages.forEach((s, i) => {
    const p = `stages[${i}]`;
    if (!isObj2(s)) {
      errs.push(`${p}: expected a map`);
      return;
    }
    if (!isStr(s.id) || !ID.test(s.id)) errs.push(`${p}.id: letters, digits, dash or underscore`);
    else if (ids.has(s.id)) errs.push(`${p}.id: duplicate "${s.id}"`);
    else ids.add(s.id);
    if (!ROLES2.includes(s.kind)) errs.push(`${p}.kind: one of ${ROLES2.join(" | ")}`);
    if (!isStr(s.label)) errs.push(`${p}.label: required text`);
  });
  const faultIds = /* @__PURE__ */ new Set();
  if (!Array.isArray(raw.faults) || raw.faults.length === 0) errs.push("faults: need at least one fault");
  else raw.faults.forEach((f, i) => {
    const p = `faults[${i}]`;
    if (!isObj2(f)) {
      errs.push(`${p}: expected a map`);
      return;
    }
    if (!isStr(f.id) || !ID.test(f.id)) errs.push(`${p}.id: letters, digits, dash or underscore`);
    else if (faultIds.has(f.id)) errs.push(`${p}.id: duplicate "${f.id}"`);
    else faultIds.add(f.id);
    if (f.stage !== "any" && !(isStr(f.stage) && ids.has(f.stage))) errs.push(`${p}.stage: must be a declared stage id or "any"`);
    if (!isStr(f.creature)) errs.push(`${p}.creature: required text`);
    if (!isStr(f.art) || !LAB_CREATURE_IDS.includes(f.art)) errs.push(`${p}.art: an existing creature id (${LAB_CREATURE_IDS.join(", ")})`);
    if (f.sprite !== void 0 && !(isStr(f.sprite) && PACK_SPRITE_IDS.includes(f.sprite))) errs.push(`${p}.sprite: one of ${PACK_SPRITE_IDS.join(", ")}`);
    if (!isStr(f.mode)) errs.push(`${p}.mode: required text`);
    if (!isStr(f.behavior)) errs.push(`${p}.behavior: required text`);
  });
  if (!isObj2(raw.reviews) || !isStr(raw.reviews.label) || !Array.isArray(raw.reviews.subscores) || raw.reviews.subscores.length === 0 || !raw.reviews.subscores.every(isStr)) {
    errs.push("reviews: need label and a list of subscores");
  }
  if (raw.ledger !== void 0 && !(Array.isArray(raw.ledger) && raw.ledger.every((l) => isObj2(l) && isStr(l.id)))) errs.push("ledger: list of {id}");
  if (raw.curses !== void 0) {
    if (!Array.isArray(raw.curses)) errs.push("curses: list of {id, endpoint, stage?, fault?}");
    else raw.curses.forEach((c, i) => {
      const p = `curses[${i}]`;
      if (!isObj2(c) || !isStr(c.id) || !isStr(c.endpoint)) {
        errs.push(`${p}: need id and endpoint`);
        return;
      }
      if (c.stage !== void 0 && !(isStr(c.stage) && ids.has(c.stage))) errs.push(`${p}.stage: must be a declared stage id`);
      if (c.fault !== void 0 && !(isStr(c.fault) && LAB_FAULT_IDS.includes(c.fault))) errs.push(`${p}.fault: one of ${LAB_FAULT_IDS.join(", ")}`);
    });
  }
  if (isObj2(raw.reviews) && raw.reviews.stages !== void 0) {
    const rs = raw.reviews.stages;
    const subs = Array.isArray(raw.reviews.subscores) ? raw.reviews.subscores.map(String) : [];
    if (!isObj2(rs)) errs.push("reviews.stages: map of subscore to stage ids");
    else for (const [k, v] of Object.entries(rs)) {
      if (!subs.includes(k)) errs.push(`reviews.stages.${k}: not a declared subscore`);
      else if (!Array.isArray(v) || v.length === 0 || !v.every((x) => ids.has(String(x)))) errs.push(`reviews.stages.${k}: list of declared stage ids`);
    }
  }
  if (raw.bosses !== void 0) {
    if (!Array.isArray(raw.bosses)) errs.push("bosses: expected a list");
    else raw.bosses.forEach((b, i) => {
      if (!isObj2(b) || !isStr(b.id) || !Array.isArray(b.hits) || b.hits.length === 0) {
        errs.push(`bosses[${i}]: need id and hits`);
        return;
      }
      for (const h of b.hits) if (!ids.has(String(h))) errs.push(`bosses[${i}].hits: unknown stage "${String(h)}"`);
    });
  }
  if (!isObj2(raw.tiers)) errs.push("tiers: map of part to text");
  else for (const [k, v] of Object.entries(raw.tiers)) {
    if (!LAB_PARTS.includes(k)) errs.push(`tiers.${k}: unknown part`);
    else if (!isStr(v)) errs.push(`tiers.${k}: required text`);
  }
  if (errs.length === 0) errs.push(...validateLabModel({ name: `${String(raw.id)}-lab`, stages: stagesOf(raw) }).map((e) => `model: ${e}`));
  return errs;
}
function parsePack(text2) {
  let raw;
  try {
    raw = parseYaml(text2);
  } catch (e) {
    return { ok: false, errors: [e.message] };
  }
  const errors = validatePack(raw);
  if (errors.length) return { ok: false, errors };
  const r = raw;
  return {
    ok: true,
    pack: {
      id: r.id,
      title: String(r.title),
      modelBased: r.modelBased !== false,
      stages: stagesOf(r),
      ledger: r.ledger ?? [],
      faults: r.faults,
      curses: r.curses ?? [],
      reviews: r.reviews,
      bosses: r.bosses ?? [],
      tiers: r.tiers
    }
  };
}
function packMeta(p) {
  const creatures = {};
  for (const f of p.faults) if (!(f.art in creatures)) creatures[f.art] = f.creature;
  return { id: p.id, title: p.title, modelBased: p.modelBased, creatures, review: p.reviews, tiers: p.tiers, faults: p.faults, bosses: p.bosses, curses: p.curses };
}
function packToLabModel(p, parts = {}) {
  return { name: `${p.id}-lab`, stages: p.stages.map((s) => ({ ...s, ...s.effects ? { effects: s.effects.map((e) => ({ ...e })) } : {} })), parts: { ...parts }, pack: packMeta(p) };
}

// packages/haunt/src/lab/model.ts
var LAB_PARTS = ["retry", "journal", "idempotency", "breaker", "offline_queue"];
var PACK_SPRITE_IDS = ["buffer_wraith", "cdn_kraken", "drm_gatekeeper", "render_gremlin", "cloud_banshee", "region_ghost"];
var LAB_CREATURE_IDS = ["reaper", "wraith", "banshee", "zombie", "ghost", "goblin", "imp", "poltergeist", "doppelganger", "witch", "mummy"];
var LAB_FAULT_IDS = ["crash", "power_outage", "internet_outage", "timeout", "http_404", "http_429", "http_500", "missing_file", "duplicate_request", "malformed_payload", "disk_full"];
var ROLES2 = ["input", "work", "effect", "poll", "final"];
function partSet(m) {
  const p = m.parts ?? {};
  return { retry: !!p.retry, journal: !!p.journal, idempotency: !!p.idempotency, breaker: !!p.breaker, offline_queue: !!p.offline_queue };
}
function validateLabModel(m) {
  const errs = [];
  if (typeof m !== "object" || m === null) return ["model: expected an object"];
  const o = m;
  if (typeof o.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(o.name)) errs.push("name: letters, digits, dot, dash or underscore");
  if (!Array.isArray(o.stages) || o.stages.length === 0) {
    errs.push("stages: need at least one stage");
    return errs;
  }
  if (o.stages.length > 24) errs.push("stages: at most 24");
  const seen = /* @__PURE__ */ new Set();
  o.stages.forEach((s, i) => {
    const p = `stages[${i}]`;
    if (typeof s !== "object" || s === null) {
      errs.push(`${p}: expected an object`);
      return;
    }
    const st = s;
    if (typeof st.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(st.id)) errs.push(`${p}.id: letters, digits, dash or underscore`);
    else if (seen.has(st.id)) errs.push(`${p}.id: duplicate "${st.id}"`);
    else seen.add(st.id);
    if (!ROLES2.includes(st.role)) errs.push(`${p}.role: one of ${ROLES2.join(" | ")}`);
    if (st.effects !== void 0) {
      if (!Array.isArray(st.effects)) errs.push(`${p}.effects: expected a list`);
      else {
        if (st.effects.length > 0 && st.role !== "effect") errs.push(`${p}.effects: only on role "effect"`);
        st.effects.forEach((e, j) => {
          const eo = e;
          if (!eo || typeof eo.kind !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(eo.kind)) errs.push(`${p}.effects[${j}].kind: letters, digits, dash or underscore`);
          if (!eo || typeof eo.keyed !== "boolean") errs.push(`${p}.effects[${j}].keyed: true or false`);
        });
      }
    }
  });
  return errs;
}
function labToConfig(m) {
  const stages = m.stages.map((s) => ({
    id: s.id,
    label: s.label?.trim() || s.id,
    role: s.role,
    effects: s.role === "effect" ? (s.effects ?? []).map((e) => ({ kind: e.kind, key: e.kind, idempotent: e.keyed ? "required" : "preferred" })) : []
  }));
  return {
    name: m.name,
    start: "node dist/bot.js",
    adapter: ["sdk"],
    stages,
    ...m.stages.some((s) => s.role === "input") ? { inputs: "./inputs/" } : {},
    ...m.stages.some((s) => s.role === "effect") ? { truth: "http://127.0.0.1:7071" } : {},
    targets: { recoverMs: 2e4, repeats: 0, concurrency: 8 }
  };
}
var q = (s) => /^[A-Za-z0-9_./:-]+$/.test(s) ? s : JSON.stringify(s);
function labToYaml(m) {
  const c = labToConfig(m);
  const out = [`name: ${q(c.name)}`, `start: ${q(c.start)}`, "adapter: sdk"];
  if (c.inputs) out.push(`inputs: ${q(c.inputs)}`);
  if (c.truth) out.push(`truth: ${q(c.truth)}`);
  out.push("targets:", `  recoverMs: ${c.targets.recoverMs}`, `  repeats: ${c.targets.repeats}`, `  concurrency: ${c.targets.concurrency}`, "stages:");
  for (const s of c.stages) {
    out.push(`  - id: ${q(s.id)}`, `    label: ${q(s.label)}`, `    role: ${s.role}`);
    if (s.effects.length) {
      out.push("    effects:");
      for (const e of s.effects) out.push(`      - { kind: ${q(e.kind)}, key: ${q(e.key)}, idempotent: ${e.idempotent} }`);
    }
  }
  return out.join("\n") + "\n";
}
function configToLab(c) {
  return {
    name: c.name,
    stages: c.stages.map((s) => ({ id: s.id, label: s.label, role: s.role, ...s.role === "effect" ? { effects: s.effects.map((e) => ({ kind: e.kind, keyed: e.idempotent === "required" })) } : {} }))
  };
}
var eff2 = (kind, keyed = false) => ({ kind, keyed });
var LAB_PRESETS = {
  orders: {
    name: "orders-lab",
    stages: [
      { id: "account", label: "Account or login", role: "effect", effects: [eff2("account")] },
      { id: "create", label: "Create order", role: "input" },
      { id: "submit", label: "Submit order", role: "effect", effects: [eff2("order")] },
      { id: "payment", label: "Payment", role: "effect", effects: [eff2("charge")] },
      { id: "confirmation", label: "Confirmation", role: "effect", effects: [eff2("email")] },
      { id: "receive", label: "Store receives", role: "effect", effects: [eff2("store")] },
      { id: "process", label: "Process order", role: "effect", effects: [eff2("store")] },
      { id: "ship", label: "Ship and pack", role: "effect", effects: [eff2("dispatch")] },
      { id: "transit", label: "Delivery updates", role: "poll" }
    ]
  },
  inbox: {
    name: "inbox-lab",
    stages: [
      { id: "fetch", label: "Fetch mail", role: "input" },
      { id: "classify", label: "Classify", role: "work" },
      { id: "reply", label: "Send reply", role: "effect", effects: [eff2("reply")] },
      { id: "archive", label: "Archive", role: "final" }
    ]
  },
  payments: {
    name: "payments-lab",
    stages: [
      { id: "receive", label: "Receive batch", role: "input" },
      { id: "validate", label: "Validate", role: "work" },
      { id: "charge", label: "Charge card", role: "effect", effects: [eff2("charge")] },
      { id: "ledger", label: "Write ledger", role: "effect", effects: [eff2("ledger")] },
      { id: "settle", label: "Wait for settlement", role: "poll" }
    ]
  },
  // Lazy: built from the embedded pack text on first read (the packs module imports this one).
  get streaming() {
    return packPreset(STREAMING_PACK_YAML);
  },
  report: {
    name: "report-lab",
    stages: [
      { id: "pull", label: "Pull data", role: "input" },
      { id: "build", label: "Build report", role: "work" },
      { id: "publish", label: "Publish", role: "effect", effects: [eff2("publish")] },
      { id: "notify", label: "Notify owners", role: "final" }
    ]
  }
};
for (const id of Object.keys(EMBEDDED_PACKS)) {
  if (id in LAB_PRESETS) continue;
  Object.defineProperty(LAB_PRESETS, id, { enumerable: true, configurable: true, get: () => packPreset(EMBEDDED_PACKS[id]) });
}
var LAB_COMMANDS = ["npm run haunt -- init", "npm run haunt -- validate", "npm run haunt -- sweep"];
function labCommands(model) {
  const id = model.pack?.id;
  if (!id) return LAB_COMMANDS;
  return [`npm run haunt -- init --pack ${id}`, `npm run haunt -- pack check ${id}`, "npm run haunt -- validate", "npm run haunt -- sweep"];
}
function packPreset(yaml) {
  const r = parsePack(yaml);
  if (!r.ok) throw new Error(`embedded pack is invalid: ${r.errors.join("; ")}`);
  return packToLabModel(r.pack);
}

// packages/haunt/src/lab/engine.ts
var LAB_LABEL = "Model-based what-if: results come from rules over the protections you declare, not from running your real code.";
var LAB_CREATURES = [
  { id: "reaper", label: "Reaper", fault: "crash", roles: ["input", "work", "effect", "poll", "final"] },
  { id: "wraith", label: "Wraith", fault: "power_outage", roles: ["input", "work", "effect", "poll", "final"] },
  { id: "banshee", label: "Banshee", fault: "internet_outage", roles: ["effect", "poll"] },
  { id: "zombie", label: "Zombie", fault: "timeout", roles: ["effect"] },
  { id: "ghost", label: "Ghost", fault: "http_404", roles: ["effect"] },
  { id: "goblin", label: "Goblin", fault: "http_429", roles: ["effect", "poll"] },
  { id: "imp", label: "Imp", fault: "http_500", roles: ["effect", "poll"] },
  { id: "poltergeist", label: "Poltergeist", fault: "missing_file", roles: ["input"] },
  { id: "doppelganger", label: "Doppelganger", fault: "duplicate_request", roles: ["input"] },
  { id: "witch", label: "Witch", fault: "malformed_payload", roles: ["input"] },
  { id: "mummy", label: "Mummy", fault: "disk_full", roles: ["work", "final"] }
];
var PROCESS_FAULTS = /* @__PURE__ */ new Set(["crash", "out_of_memory", "power_outage"]);
var LONG_FAULTS = /* @__PURE__ */ new Set(["internet_outage", "endpoint_down", "slow_link"]);
var MODE_FAULT = {
  duplicate: "duplicate_request",
  timeout: "timeout",
  stall: "timeout",
  status: "http_500",
  crash: "crash",
  outage: "internet_outage",
  expire: "http_404",
  corrupt: "malformed_payload",
  misroute: "malformed_payload"
};
function packFaultOf(f) {
  return MODE_FAULT[f.mode] ?? LAB_CREATURES.find((c) => c.id === f.art)?.fault ?? "crash";
}
function labPlan(model) {
  const cells = [];
  for (const s of model.stages) for (const c of LAB_CREATURES) if (c.roles.includes(s.role)) cells.push({ stage: s.id, creature: c.id, fault: c.fault });
  const known = new Set(model.stages.map((s) => s.id));
  for (const f of model.pack?.faults ?? []) {
    if (!known.has(f.stage) || cells.some((c) => c.stage === f.stage && c.creature === f.art)) continue;
    cells.push({ stage: f.stage, creature: f.art, fault: packFaultOf(f) });
  }
  return { stages: model.stages.map((s) => s.id), creatures: LAB_CREATURES.map((c) => c.id), cells };
}
var RANK = { pass: 0, recovered_late: 1, repeat: 2, fail: 3, halt: 4 };
var worse = (a, b) => (RANK[b.outcome] ?? 0) > (RANK[a.outcome] ?? 0) ? b : a;
function labCurses(model) {
  const known = new Set(model.stages.map((s) => s.id));
  const dflt = (model.stages.find((s) => s.role === "effect") ?? model.stages[0])?.id;
  const out = [];
  for (const c of model.pack?.curses ?? []) {
    const stage = c.stage ?? dflt;
    if (stage && known.has(stage)) out.push({ id: c.id, endpoint: c.endpoint, stage, fault: c.fault ?? "http_500" });
  }
  return out;
}
function labCell(stage, fault, p) {
  const effects = stage.role === "effect" ? stage.effects ?? [] : [];
  const unprotected = effects.filter((e) => !(p.idempotency && e.keyed));
  const repeat = () => ({
    outcome: "repeat",
    repeatedKinds: unprotected.length ? unprotected.map((e) => e.kind) : [stage.id]
  });
  if (PROCESS_FAULTS.has(fault)) {
    if (p.journal) return unprotected.length ? repeat() : { outcome: "pass" };
    if (unprotected.length && !p.offline_queue) return repeat();
    if (p.offline_queue) return { outcome: "recovered_late" };
    if (fault === "power_outage") return { outcome: "halt", lost: effects.length > 0 };
    return { outcome: "fail", lost: effects.length > 0 };
  }
  if (fault === "timeout") {
    if (p.retry) return unprotected.length ? repeat() : { outcome: "pass" };
    return p.offline_queue ? { outcome: "recovered_late" } : { outcome: "fail" };
  }
  if (LONG_FAULTS.has(fault)) {
    if (p.retry && p.breaker) return { outcome: "pass" };
    if (p.offline_queue || p.breaker) return { outcome: "recovered_late" };
    return { outcome: "fail" };
  }
  if (fault === "http_404" || fault === "http_429" || fault === "http_500") {
    if (p.retry) return { outcome: "pass" };
    return p.offline_queue ? { outcome: "recovered_late" } : { outcome: "fail" };
  }
  if (fault === "missing_file") return p.offline_queue ? { outcome: "recovered_late" } : { outcome: "fail" };
  if (fault === "duplicate_request") return p.idempotency ? { outcome: "pass" } : repeat();
  if (fault === "malformed_payload") return p.offline_queue ? { outcome: "recovered_late" } : { outcome: "halt" };
  if (fault === "disk_full") return p.offline_queue ? { outcome: "recovered_late" } : { outcome: "fail" };
  return { outcome: "pass" };
}
function evidenceFor(report, p) {
  const events = [];
  const journal = [];
  const ledger = [];
  let seq = 0;
  const push = (type, lane, order, stage, detail = {}) => events.push({ seq: ++seq, type, lane, order, stage, detail });
  for (const c of report.cells) {
    if (c.outcome === "pass") continue;
    const lane = `${c.stage}/${c.creature}`;
    const order = `${c.stage}-${c.creature}`;
    push("chaos", lane, order, c.stage, { fault: c.fault });
    if (c.outcome === "repeat") {
      for (const kind of c.repeatedKinds ?? [c.stage]) {
        push("repeat", lane, order, c.stage, { kind, fault: c.fault });
        if (p.journal) {
          journal.push({ order, kind });
          ledger.push({ order, kind }, { order, kind });
        }
      }
    } else if (c.outcome === "halt") {
      push("lane_halted", lane, order, c.stage, { error: `unhandled ${c.fault}` });
    } else if (c.outcome === "fail") {
      const err = c.fault === "missing_file" ? "ENOENT: no such file" : c.fault === "http_500" ? "status 500" : c.fault === "http_429" ? "status 429" : c.fault === "timeout" || LONG_FAULTS.has(c.fault) ? "timeout" : c.fault;
      const transient = c.fault !== "disk_full" && !PROCESS_FAULTS.has(c.fault);
      const n = p.retry && LONG_FAULTS.has(c.fault) ? 3 : 1;
      for (let i = 0; i < n; i++) push("stage_fail", lane, order, c.stage, { error: err, fault: c.fault, retryable: transient });
      if (PROCESS_FAULTS.has(c.fault)) push("recover_done", lane, order, c.stage, { ms: 45e3 });
      push("order_failed", lane, order, c.stage, { error: err });
    }
  }
  return { events, journal, ledger };
}
var PART_TEXT = {
  retry: { why: "A transient error ended an order that a second try would have saved.", how: "Add bounded retries with backoff around the call." },
  journal: { why: "After a crash the bot has no record of where it was, so recovery is slow or the order is lost.", how: "Write each completed step to a journal and replay it on start." },
  idempotency: { why: "A side effect ran twice (a repeat or a retry after a timeout).", how: "Send an idempotency key with every effect and check it before acting." },
  breaker: { why: "Repeated failures hammered a dead dependency.", how: "Open a circuit breaker after a few failures and probe before closing." },
  offline_queue: { why: "A missing input, bad payload or outage halted the lane.", how: "Park the order in an offline queue, quarantine bad input and resume later." }
};
var partId = (s) => s.replace(/ /g, "_");
function suggestionsFrom(findings, p, model) {
  const by = /* @__PURE__ */ new Map();
  for (const f of findings) {
    const key = partId(f.suggestedPart);
    by.set(key, [...by.get(key) ?? [], f]);
  }
  const out = [];
  for (const [part, fs] of by) {
    const on = p[part] === true;
    const text2 = PART_TEXT[part] ?? { why: "The reviewer flagged this stage.", how: "Review the recovery code." };
    let how = text2.how;
    if (part === "idempotency" && on) {
      const unkeyed = model.stages.flatMap((s) => (s.effects ?? []).filter((e) => !e.keyed).map((e) => `${s.id}.${e.kind}`));
      how = unkeyed.length ? `The part is on, but these effects carry no key: ${unkeyed.join(", ")}. Add one to each.` : how;
    }
    out.push({
      part,
      rules: [...new Set(fs.map((f) => f.rule))].sort(),
      stages: [...new Set(fs.map((f) => f.stage))],
      findings: fs.length,
      alreadyOn: on,
      why: text2.why,
      how
    });
  }
  const rank = (s) => -s.findings;
  return out.sort((a, b) => rank(a) - rank(b) || (a.part < b.part ? -1 : 1));
}
async function sweepModel(model, p, seed) {
  const byId = new Map(model.stages.map((s) => [s.id, s]));
  const curses = labCurses(model);
  return runSweep(labPlan(model), (cell) => {
    const stage = byId.get(cell.stage);
    let d2 = labCell(stage, cell.fault, p);
    for (const c of curses) if (c.stage === cell.stage) d2 = worse(d2, labCell(stage, c.fault, p));
    return d2;
  }, seed);
}
function labBosses(model, p) {
  const pack = model.pack;
  if (!pack) return [];
  const byId = new Map(model.stages.map((s) => [s.id, s]));
  const curses = labCurses(model);
  return pack.bosses.filter((b) => b.hits.every((h) => byId.has(h))).map((b) => {
    const cells = [];
    for (const h of b.hits) {
      const stage = byId.get(h);
      const faults = pack.faults.filter((f) => f.stage === h);
      const list = faults.length ? faults.map((f) => ({ fault: packFaultOf(f), creature: f.creature })) : [{ fault: "crash", creature: "Reaper" }];
      for (const x of list) {
        let d2 = labCell(stage, x.fault, p);
        for (const c of curses) if (c.stage === h) d2 = worse(d2, labCell(stage, c.fault, p));
        if (b.hits.length >= 3 && d2.outcome === "pass" && p.retry && !p.breaker && !p.offline_queue && x.fault !== "duplicate_request") d2 = { outcome: "recovered_late" };
        cells.push({ stage: h, fault: x.fault, creature: x.creature, outcome: d2.outcome });
      }
    }
    const outcome = cells.reduce((w, c) => (RANK[c.outcome] ?? 0) > (RANK[w] ?? 0) ? c.outcome : w, "pass");
    return { id: b.id, label: b.label ?? b.id, ...b.story ? { story: b.story } : {}, hits: [...b.hits], cells, outcome, survived: RANK[outcome] <= RANK.recovered_late };
  });
}
function labReview(model, cells) {
  const rv = model.pack?.review;
  if (!rv) return void 0;
  const score = (stages) => {
    const own = stages.length ? cells.filter((c) => stages.includes(c.stage)) : cells;
    if (!own.length) return 5;
    const frac = own.reduce((n, c) => n + (c.outcome === "pass" ? 1 : c.outcome === "recovered_late" ? 0.5 : 0), 0) / own.length;
    let stars = Math.max(1, Math.round(1 + 4 * frac));
    if (own.some((c) => c.outcome === "repeat")) stars = Math.min(stars, 2);
    if (own.some((c) => c.lost)) stars = 1;
    return stars;
  };
  const subscores = rv.subscores.map((id) => ({ id, stars: score(rv.stages?.[id] ?? []), stages: rv.stages?.[id] ?? [] }));
  const overall = Math.round(subscores.reduce((n, s) => n + s.stars, 0) / Math.max(1, subscores.length) * 10) / 10;
  return { label: rv.label, overall, subscores };
}
var nowMs = () => typeof performance !== "undefined" ? performance.now() : 0;
async function labRun(model) {
  const errs = validateLabModel(model);
  if (errs.length) throw new Error(`invalid lab model: ${errs.join("; ")}`);
  const t0 = nowMs();
  const seed = model.seed ?? 1;
  const p = partSet(model);
  const report = await sweepModel(model, p, seed);
  const bosses = labBosses(model, p);
  const curses = labCurses(model).map((c) => {
    const st = model.stages.find((s) => s.id === c.stage);
    return { ...c, creature: LAB_CREATURES.find((x) => x.fault === c.fault)?.label ?? c.fault, outcome: labCell(st, c.fault, p).outcome };
  });
  const bossCells = bosses.flatMap((b) => b.cells.filter((c) => c.outcome !== "pass").map((c) => ({ stage: c.stage, creature: `boss-${b.id}`, fault: c.fault, outcome: c.outcome })));
  const ev = evidenceFor({ cells: [...report.cells, ...bossCells] }, p);
  const review = labReview(model, report.cells);
  const inputStages = model.stages.filter((s) => s.role === "input").map((s) => s.id);
  const findings = reviewEvents(ev.events, {
    inputStages,
    ...p.journal && ev.ledger.length ? { journal: ev.journal, ledger: ev.ledger } : {}
  });
  const suggestions = suggestionsFrom(findings, p, model);
  const all = { ...p };
  for (const s of suggestions) if (s.part in all) all[s.part] = true;
  const keyed = { ...model, stages: model.stages.map((s) => ({ ...s, effects: s.effects?.map((e) => ({ ...e, keyed: all.idempotency ? true : e.keyed })) })) };
  const after = await sweepModel(keyed, all, seed);
  return {
    modelBased: true,
    label: LAB_LABEL,
    name: model.name,
    seed,
    parts: p,
    ...model.pack ? { pack: model.pack } : {},
    creatureLabels: { ...Object.fromEntries(LAB_CREATURES.map((c) => [c.id, c.label])), ...model.pack?.creatures ?? {} },
    grade: report.grade,
    reliability: report.reliability,
    bosses,
    curses,
    ...review ? { review } : {},
    matrix: report.matrix,
    cells: report.cells,
    findings,
    suggestions,
    gradeWithSuggestions: after.grade,
    yaml: labToYaml(model),
    commands: labCommands(model),
    elapsedMs: Math.max(0, Math.round(nowMs() - t0))
  };
}

// packages/haunt/src/blocks/alone.ts
var aloneId = (blockId) => `block-${blockId.replace(/_/g, "-")}`;
function blockAsConfig(blockId) {
  const b = blockById(blockId);
  if (!b) return null;
  return {
    name: aloneId(b.id),
    label: `Block: ${b.label}`,
    idPrefix: "blk",
    start: "node dist/bot.js",
    adapter: ["sdk"],
    stages: [{ id: b.id, label: b.label, role: b.role, effects: b.effects.map((e) => ({ ...e })), duration: b.duration, block: b.id }],
    ...b.effects.length ? { truth: "http://127.0.0.1:7071" } : {},
    targets: { recoverMs: 2e4, repeats: 0, concurrency: 8 }
  };
}

// packages/haunt/src/blocks/cards.ts
var PROTECTIONS = ["retry", "journal", "idempotency", "breaker", "offline_queue"];
var protectionsOf = (tier) => ({ ...PACK_TIERS[tier] });
function tierOfProtections(p) {
  const on = (x) => PROTECTIONS.filter((k) => x[k]).join();
  return CARD_TIERS.find((t) => on(PACK_TIERS[t]) === on(p)) ?? "custom";
}
var CARD_TIERS = ["rookie", "retrier", "journaler", "reconciler", "phoenix"];
var BAD = /* @__PURE__ */ new Set(["fail", "halt", "repeat"]);
var withTier = (m, tier) => {
  const parts = typeof tier === "string" ? protectionsOf(tier) : { ...tier };
  return { ...m, parts, stages: m.stages.map((s) => s.effects ? { ...s, effects: s.effects.map((e) => ({ ...e, keyed: parts.idempotency === true })) } : s) };
};
function cardOf(blockId, tier, role, rep) {
  const cells = rep.cells;
  return {
    blockId,
    tier,
    role,
    grade: String(rep.grade),
    reliability: rep.reliability,
    tried: cells.length,
    survived: cells.filter((c) => c.outcome === "pass" || c.outcome === "recovered_late").length,
    repeats: cells.filter((c) => c.outcome === "repeat").length,
    failedFaults: cells.filter((c) => BAD.has(c.outcome)).map((c) => `${c.fault}:${c.outcome}`),
    modelBased: true
  };
}
async function runBlock(blockId, tier, seed = 1) {
  const cfg = blockAsConfig(blockId);
  if (!cfg) return null;
  return cardOf(blockId, typeof tier === "string" ? tier : tierOfProtections(tier), blockById(blockId).role, await labRun({ ...withTier(configToLab(cfg), tier), seed }));
}
async function allBlockCards(seed = 1) {
  const out = [];
  for (const b of BLOCKS) for (const t of CARD_TIERS) {
    const c = await runBlock(b.id, t, seed);
    if (c) out.push(c);
  }
  return out;
}
async function chainReport(cfg, tier, seed = 1) {
  const rep = await labRun({ ...withTier(configToLab(cfg), tier), seed });
  const blockOf = new Map(cfg.stages.map((s) => [s.id, s.block]));
  const per = /* @__PURE__ */ new Map();
  for (const c of rep.cells) {
    const p = per.get(c.stage) ?? { tried: 0, failed: 0 };
    p.tried++;
    if (BAD.has(c.outcome)) p.failed++;
    per.set(c.stage, p);
  }
  const failed = [...per.values()].reduce((a, p) => a + p.failed, 0);
  const blame = cfg.stages.map((s) => {
    const p = per.get(s.id) ?? { tried: 0, failed: 0 };
    const b = blockOf.get(s.id);
    return { stage: s.id, ...b ? { block: b } : {}, tried: p.tried, failed: p.failed, share: failed === 0 ? 0 : p.failed / failed };
  });
  return { grade: String(rep.grade), reliability: rep.reliability, tier: typeof tier === "string" ? tier : tierOfProtections(tier), tried: rep.cells.length, failed, blame, modelBased: true };
}
function chainChecks(cfg, cards = []) {
  const out = [];
  const st = cfg.stages;
  if (!st.some((s) => s.role === "input")) out.push({ id: "no_input", message: "The chain has no input stage, so a lost or bad input cannot be tested." });
  const effects = st.filter((s) => s.role === "effect");
  const keyOf = (s) => s.effects.map((e) => e.key);
  const seen = /* @__PURE__ */ new Map();
  for (const s of effects) for (const k of keyOf(s)) {
    if (seen.has(k)) out.push({ id: "shared_key", stage: s.id, message: `${s.id} and ${seen.get(k)} use the same effect key "${k}", so one can hide the other's repeat.` });
    else seen.set(k, s.id);
  }
  for (const s of effects) for (const e of s.effects) if (e.idempotent !== "required" && effects.length > 1) out.push({ id: "loose_effect", stage: s.id, message: `${s.id}: "${e.kind}" does not require an idempotency key, so a retry after a crash can repeat it.` });
  st.forEach((s, i) => {
    if (s.role === "poll" && !(s.duration && s.duration[1] > 0)) out.push({ id: "poll_no_limit", stage: s.id, message: `${s.id}: a poll with no time limit can wait forever.` });
    if (s.role === "poll" && i > 0 && st[i - 1].role === "effect") out.push({ id: "poll_after_effect", stage: s.id, message: `${s.id} waits right after the effect in ${st[i - 1].id}; a crash while waiting must not redo that effect.` });
  });
  if (st.length > 12 && !st.some((s) => s.role === "input")) out.push({ id: "long_chain", message: "A long chain with no input stage is hard to test." });
  for (const s of st) {
    const bad = cards.filter((c) => c.blockId === s.block && (c.repeats > 0 || c.failedFaults.length > 0));
    if (s.block && bad.length > 0 && st.length > 1) out.push({ id: "weak_block", stage: s.id, message: `${s.id} (${s.block}) did not pass alone at ${bad[0].tier}: ${bad[0].failedFaults.slice(0, 3).join(", ")}.` });
  }
  return out;
}

// packages/haunt/src/mcp/server.ts
var str = (type, description) => ({ type, description });
var TIERS2 = ["rookie", "retrier", "journaler", "reconciler", "phoenix"];
var runProps = {
  tier: { type: "string", enum: TIERS2, description: "Bot tier to run" },
  seed: str("number", "Seed"),
  orders: str("number", "Orders per cell"),
  speed: str("number", "Speed multiplier"),
  config: str("string", "Path to haunt.yaml"),
  bot: str("string", "Path to a built bot")
};
var TOOLS = [
  { name: "haunt_define", description: "Load and validate a haunt.yaml and return its stages and targets.", inputSchema: { type: "object", properties: { config: str("string", "Path to haunt.yaml (default apps/haunted-orders/haunt.yaml)") } } },
  { name: "haunt_blocks", description: "List the 22 reusable blocks (id, role, what it is for). With a tier, also run each block alone against every fault that fits its role and return its card (attacks tried, survived, repeats, failed faults). Model-based.", inputSchema: { type: "object", properties: { tier: { type: "string", enum: TIERS2, description: "Add alone-cards at this tier" }, block: str("string", "Only this block id") } } },
  { name: "haunt_chain", description: "Test a chain: give block ids in order (blocks) or a haunt.yaml (config). Returns the grade, reliability, which stage and block caused which share of the failures, and warnings a chain can have although its blocks passed alone. Model-based.", inputSchema: { type: "object", properties: { blocks: { type: "array", items: { type: "string" }, description: 'Block ids in order, for example ["read_request","charge","notify"]' }, config: str("string", "Path to a haunt.yaml (stages may use `use: <block>`)"), tier: { type: "string", enum: TIERS2, description: "Tier to test with (default rookie)" }, seed: str("number", "Seed") } } },
  { name: "haunt_lab", description: "Model-based what-if of any haunt.yaml: grade, the failing cells, findings and the parts to add. Needs no running bot.", inputSchema: { type: "object", properties: { config: str("string", "Path to haunt.yaml"), tier: { type: "string", enum: TIERS2, description: "Protections to assume (default rookie)" }, seed: str("number", "Seed") }, required: ["config"] } },
  { name: "haunt_sweep", description: "Run a graded fault sweep (one creature fault per stage) and return the matrix and grade.", inputSchema: { type: "object", properties: runProps } },
  { name: "haunt_ramp", description: "Run a load ramp and return the knee, break point and grade.", inputSchema: { type: "object", properties: runProps } },
  { name: "haunt_report", description: "Read a saved sweep or ramp report JSON (latest in .haunt if no path is given).", inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["sweep", "ramp"] }, path: str("string", "Report file path") } } },
  { name: "haunt_specs", description: "Fix specs of the pattern miner: list the qualifying patterns and hardening folders, write .kiro/specs/hardening-<run> for the patterns still new, or lint a spec folder (evidence, patch, test, no rewrite).", inputSchema: { type: "object", properties: { action: { type: "string", enum: ["list", "write", "lint"], description: "list (default), write or lint" }, run: str("string", "Run id for write"), dir: str("string", "Spec folder for lint") } } },
  { name: "haunt_badge", description: "Write the grade badge and scorecard (SVG and HTML) for a saved run into a local folder.", inputSchema: { type: "object", properties: { run: str("string", "Report path or run name under .haunt/sweeps"), out: str("string", "Output folder (default .)"), improve: str("string", "Improve report JSON: write the closed n of m before and after card instead") }, required: [] } }
];
var text = (t, isError = false) => ({ content: [{ type: "text", text: t }], isError });
function runCli(opts, sub, a) {
  if (!opts.cliEntry && !existsSync4(join3(opts.root, "tools", "run-ts.mjs"))) {
    return Promise.resolve(text(`${sub} needs a Kiroween Chaos checkout: set HAUNT_ROOT to its folder (git clone https://github.com/kakoritz/Kiroween-Chaos-Official.git, then npm ci). haunt_define, haunt_blocks, haunt_chain and haunt_lab work without it.`, true));
  }
  const entry = opts.cliEntry ?? join3(opts.root, "packages", "core", "src", "bin", "haunt.ts");
  const args = [join3(opts.root, "tools", "run-ts.mjs"), entry, sub];
  for (const k of ["tier", "seed", "orders", "speed", "config", "bot"]) if (a[k] !== void 0) args.push(`--${k}`, String(a[k]));
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd: opts.root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
    }, opts.runTimeoutMs ?? 6e5);
    child.stdout.on("data", (d2) => {
      out += d2;
    });
    child.stderr.on("data", () => void 0);
    child.on("close", (code) => {
      clearTimeout(timer);
      done(text(out.trim() || `exit ${code}`, code !== 0));
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      done(text(String(e), true));
    });
  });
}
function latestReport(root, kind) {
  const dir = join3(root, ".haunt", kind === "ramp" ? "ramps" : "sweeps");
  if (!existsSync4(dir)) return void 0;
  const files = readdirSync2(dir).filter((f) => f.endsWith(".json")).sort();
  return files.length ? join3(dir, files[files.length - 1]) : void 0;
}
var tierOf = (v) => CARD_TIERS.includes(v) ? v : "rookie";
var seedOf = (v) => typeof v === "number" && Number.isFinite(v) ? v : 1;
function configFromArgs(opts, a) {
  if (Array.isArray(a.blocks)) {
    const ids = a.blocks.map(String);
    const bad = ids.filter((id) => !BLOCKS.some((b) => b.id === id));
    if (ids.length === 0 || bad.length > 0) return { ok: false, error: ids.length === 0 ? "blocks: give at least one block id" : `unknown block(s): ${bad.join(", ")} (call haunt_blocks for the list)` };
    const yaml = ["name: chain", "start: node bot.js", "truth: http://127.0.0.1:7071", "stages:", ...ids.map((id) => `  - { use: ${id} }`)].join("\n");
    const r = parseHauntConfig(yaml);
    return r.ok ? { ok: true, config: r.config } : { ok: false, error: r.errors.join("; ") };
  }
  if (typeof a.config === "string" && a.config) {
    const path = resolve2(opts.root, a.config);
    if (!existsSync4(path)) return { ok: false, error: `config not found: ${path}` };
    const r = loadHauntConfig(path);
    return r.ok ? { ok: true, config: r.config } : { ok: false, error: r.errors.join("; ") };
  }
  return { ok: false, error: "give blocks (a list of block ids) or config (a haunt.yaml path)" };
}
async function callTool(opts, name, a) {
  if (name === "haunt_blocks") {
    const list = BLOCKS.filter((b) => a.block === void 0 || b.id === a.block);
    if (list.length === 0) return text(`unknown block: ${String(a.block)}`, true);
    const base = list.map((b) => ({ id: b.id, label: b.label, role: b.role, about: b.about, effects: b.effects.map((e) => e.kind) }));
    if (a.tier === void 0) return text(JSON.stringify({ blocks: base }));
    const tier = tierOf(a.tier);
    const cards = a.block !== void 0 ? [await runBlock(String(a.block), tier, seedOf(a.seed))] : (await allBlockCards(seedOf(a.seed))).filter((c) => c.tier === tier);
    return text(JSON.stringify({ tier, modelBased: true, blocks: base, cards }));
  }
  if (name === "haunt_chain") {
    const c = configFromArgs(opts, a);
    if (!c.ok) return text(c.error, true);
    const tier = tierOf(a.tier);
    const report = await chainReport(c.config, tier, seedOf(a.seed));
    const cards = (await Promise.all(c.config.stages.filter((s) => s.block).map((s) => runBlock(s.block, tier, seedOf(a.seed))))).filter((x) => x !== null);
    return text(JSON.stringify({ ...report, warnings: chainChecks(c.config, cards) }));
  }
  if (name === "haunt_lab") {
    const c = configFromArgs(opts, a);
    if (!c.ok) return text(c.error, true);
    const tier = tierOf(a.tier);
    const rep = await labRun({ ...configToLab(c.config), parts: { ...PACK_TIERS[tier] }, seed: seedOf(a.seed) });
    const bad = rep.cells.filter((x) => x.outcome !== "pass" && x.outcome !== "recovered_late");
    return text(JSON.stringify({ modelBased: true, name: rep.name, tier, grade: rep.grade, reliability: rep.reliability, gradeWithSuggestions: rep.gradeWithSuggestions, failingCells: bad.slice(0, 30).map((x) => ({ stage: x.stage, fault: x.fault, outcome: x.outcome })), findings: rep.findings.slice(0, 10), suggestions: rep.suggestions.slice(0, 10) }));
  }
  if (name === "haunt_define") {
    const path = resolve2(opts.root, String(a.config ?? join3("apps", "haunted-orders", "haunt.yaml")));
    if (!existsSync4(path)) return text(`config not found: ${path}`, true);
    const r = loadHauntConfig(path);
    if (!r.ok) return text(JSON.stringify({ ok: false, errors: r.errors }), true);
    return text(JSON.stringify({ ok: true, config: r.config }));
  }
  if (name === "haunt_sweep" || name === "haunt_ramp") return runCli(opts, name === "haunt_sweep" ? "sweep" : "ramp", a);
  if (name === "haunt_report") {
    const kind = a.kind === "ramp" ? "ramp" : "sweep";
    const path = a.path ? resolve2(opts.root, String(a.path)) : latestReport(opts.root, kind);
    if (!path || !existsSync4(path)) return text("no report found", true);
    try {
      return text(JSON.stringify(JSON.parse(readFileSync5(path, "utf8"))));
    } catch (e) {
      return text(`unreadable report: ${String(e)}`, true);
    }
  }
  if (name === "haunt_specs") {
    const action = String(a.action ?? "list");
    const specsDir = join3(opts.root, ".kiro", "specs");
    const store = new FilePatternStore(join3(opts.root, ".haunt", "patterns.json"));
    if (action === "list") {
      const patterns = store.list().filter(qualifies).sort((x, y) => costOf(y) - costOf(x)).map((p) => ({ id: p.id, signature: p.signature, status: p.status, count: p.count, downtimeMsTotal: p.downtimeMsTotal, lostOrders: p.lostOrders, repeats: p.repeats }));
      return text(JSON.stringify({ patterns, specs: listSpecs(specsDir) }));
    }
    if (action === "lint") {
      if (typeof a.dir !== "string" || !a.dir) return text("dir required", true);
      const dir = resolve2(opts.root, a.dir);
      if (!existsSync4(dir)) return text(`not found: ${dir}`, true);
      const r = lintSpecDir(dir);
      return text(JSON.stringify(r), !r.ok);
    }
    if (action === "write") {
      if (typeof a.run !== "string" || !a.run) return text("run required", true);
      const todo = store.list().filter((p) => qualifies(p) && p.status === "new");
      if (!todo.length) return text("no qualifying pattern is waiting for a spec", true);
      try {
        const w = writeFixSpec(specsDir, { runId: a.run, patterns: todo });
        store.setStatuses(w.included.map((p) => p.id), "suggested");
        return text(JSON.stringify({ dir: w.dir, patterns: w.included.map((p) => p.id), refused: w.refused.map((r) => r.pattern.signature), lint: w.lint }), !w.lint.ok);
      } catch (e) {
        return text(String(e instanceof Error ? e.message : e), true);
      }
    }
    return text(`unknown action: ${action}`, true);
  }
  if (name === "haunt_badge") {
    if (typeof a.improve === "string" && a.improve) {
      const ri = writeImproveFiles(opts.root, a.improve, String(a.out ?? "."));
      return "error" in ri ? text(ri.error, true) : text(JSON.stringify(ri));
    }
    if (typeof a.run !== "string" || !a.run) return text("run or improve required", true);
    const r = writeBadgeFiles(opts.root, a.run, String(a.out ?? "."));
    return "error" in r ? text(r.error, true) : text(JSON.stringify(r));
  }
  return text(`unknown tool: ${name}`, true);
}
async function handle(opts, msg) {
  const id = msg.id;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (id === void 0) return void 0;
  switch (msg.method) {
    case "initialize":
      return reply({ protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "haunt-mcp", title: "Kiroween Chaos", version: "0.1.0" } });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const p = msg.params ?? {};
      if (typeof p.name !== "string") return fail(-32602, "name required");
      if (!TOOLS.some((t) => t.name === p.name)) return fail(-32602, `unknown tool: ${p.name}`);
      return reply(await callTool(opts, p.name, p.arguments ?? {}));
    }
    default:
      return fail(-32601, `method not found: ${String(msg.method)}`);
  }
}
function serveStdio(opts, input = process.stdin, output = process.stdout) {
  const rl = createInterface({ input });
  const pending = [];
  rl.on("line", (line) => {
    if (!line.trim()) return;
    pending.push((async () => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}
`);
        return;
      }
      const res = await handle(opts, msg);
      if (res) output.write(`${JSON.stringify(res)}
`);
    })());
  });
  return new Promise((done) => rl.on("close", () => {
    void Promise.all(pending).then(() => done());
  }));
}

// packages/core/src/bin/haunt-mcp.ts
await serveStdio({ root: process.env.HAUNT_ROOT ?? process.cwd() });
