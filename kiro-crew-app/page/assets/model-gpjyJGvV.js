const A={streaming:`# Streaming service pack. Model-based demo: results come from rules over declared protections, not real code.
id: streaming
title: Haunted Stream
modelBased: true
stages:
  - { id: login, label: Account or login, kind: effect, effects: [{ kind: session, keyed: true }] }
  - { id: profile, label: Profile pick, kind: work }
  - { id: browse, label: Browse, kind: input }
  - { id: title_select, label: Title select, kind: work }
  - { id: entitlement, label: Entitlement check, kind: effect, effects: [{ kind: purchase, keyed: true }] }
  - { id: license, label: License or DRM, kind: effect, effects: [{ kind: license, keyed: true }] }
  - { id: start_stream, label: Start stream, kind: effect, effects: [{ kind: playback, keyed: true }] }
  - { id: buffering, label: Buffering and bitrate, kind: poll }
  - { id: render, label: Render, kind: work }
  - { id: ads, label: Ads and pause or resume, kind: effect, effects: [{ kind: ad_impression, keyed: true }] }
  - { id: finish, label: Finish and history, kind: effect, effects: [{ kind: history, keyed: true }] }
ledger:
  - { id: sessions }
  - { id: entitlements }
  - { id: playbacks }
  - { id: history }
faults:
  - { id: buffering, stage: buffering, creature: Buffer Wraith, art: wraith, sprite: buffer_wraith, mode: stall, behavior: "Lower the bitrate, prefetch, do not restart the stream" }
  - { id: cdn_timeout, stage: start_stream, creature: CDN Kraken, art: zombie, sprite: cdn_kraken, mode: timeout, behavior: "Failover to a second CDN, circuit breaker" }
  - { id: drm_denied, stage: license, creature: DRM Gatekeeper, art: ghost, sprite: drm_gatekeeper, mode: status, behavior: "Refresh the token once, then show a clear message" }
  - { id: render_fail, stage: render, creature: Render Gremlin, art: imp, sprite: render_gremlin, mode: crash, behavior: "Restart the player, keep the position" }
  - { id: remote_server_down, stage: any, creature: Cloud Banshee, art: banshee, sprite: cloud_banshee, mode: outage, behavior: "Offline queue of watch events, resume later" }
  - { id: region_lock, stage: entitlement, creature: Region Warden, art: goblin, sprite: region_ghost, mode: status, behavior: "Clear message; no retry storm" }
  - { id: double_play, stage: start_stream, creature: Doppelganger, art: doppelganger, mode: duplicate, behavior: "Idempotent session, one stream per account" }
  - { id: watch_history_dup, stage: finish, creature: Poltergeist, art: poltergeist, mode: duplicate, behavior: "Idempotency key on the history write" }
  - { id: token_expired, stage: any, creature: Reaper, art: reaper, mode: expire, behavior: "Refresh token, do not duplicate the purchase" }
curses:
  - { id: cursed_404, endpoint: catalog, stage: browse, fault: http_404 }
  - { id: cursed_manifest, endpoint: manifest, stage: buffering, fault: http_500 }
reviews:
  label: Viewer rating
  subscores: [startup_time, buffering, render, ads, ease]
  stages:
    startup_time: [login, entitlement, license, start_stream]
    buffering: [buffering]
    render: [render]
    ads: [ads]
    ease: [profile, browse, title_select, finish]
bosses:
  - { id: cdn_kraken, label: Kraken, hits: [start_stream, buffering, render], story: "CDN plus buffering plus render in one night" }
  - { id: server_lich, label: Server Lich, hits: [login, entitlement, license, start_stream, finish], story: "The whole backend down for 30 s" }
tiers:
  retry: "Retry the manifest and segment fetches with backoff"
  journal: "Remember the playback position and the session across a crash"
  idempotency: "One stream per account and one history write per play (keys), so a retry never double-streams or re-buys"
  breaker: "Fail over to a second CDN after a few failures instead of hammering the first"
  offline_queue: "Queue watch events while the backend is down and resume later"
`,ticketing:`# Ticket desk pack (data only). Model-based; the runnable app is apps/haunted-inbox (PK-C3).
id: ticketing
title: Haunted Desk
modelBased: true
stages:
  - { id: login, label: Login or SSO, kind: effect, effects: [{ kind: session, keyed: true }] }
  - { id: create, label: Create or ingest request, kind: input }
  - { id: validate, label: Validate and enrich, kind: work }
  - { id: dedupe, label: Deduplicate, kind: work }
  - { id: triage, label: Triage and classify, kind: work }
  - { id: assign, label: Assign, kind: effect, effects: [{ kind: assignment, keyed: true }] }
  - { id: sla, label: SLA timer, kind: poll }
  - { id: notify, label: Notify, kind: effect, effects: [{ kind: notice, keyed: true }] }
  - { id: escalate, label: Escalate or update, kind: effect, effects: [{ kind: escalation, keyed: true }] }
  - { id: resolve, label: Resolve, kind: effect, effects: [{ kind: resolution, keyed: true }] }
  - { id: close, label: Close and satisfaction survey, kind: final }
ledger:
  - { id: tickets }
  - { id: assignments }
  - { id: notices }
faults:
  - { id: webhook_retry_storm, stage: create, creature: Doppelganger, art: doppelganger, mode: duplicate, behavior: "Dedupe on external id; one ticket" }
  - { id: field_mapping_error, stage: validate, creature: Witch, art: witch, mode: corrupt, behavior: "Park, report the field, do not drop the ticket" }
  - { id: rate_limited, stage: assign, creature: Goblin, art: goblin, mode: status, behavior: "Honour Retry-After, queue" }
  - { id: assignee_deleted, stage: assign, creature: Ghost, art: ghost, mode: status, behavior: "Reassign to the queue owner" }
  - { id: sla_breach, stage: sla, creature: Banshee, art: banshee, mode: outage, behavior: "Escalate once, not every minute" }
  - { id: duplicate_storm, stage: dedupe, creature: Zombie horde, art: zombie, mode: duplicate, behavior: "One master ticket, children linked" }
  - { id: wrong_queue, stage: triage, creature: Poltergeist, art: poltergeist, mode: misroute, behavior: "Reclassify with the audit trail" }
  - { id: sso_expired, stage: login, creature: Reaper, art: reaper, mode: expire, behavior: "Refresh, never create a second account" }
  - { id: notify_down, stage: notify, creature: Banshee Queen, art: wraith, mode: outage, behavior: "Retry later; a missed notice is logged, not lost" }
curses:
  - { id: cursed_tracker, endpoint: tracker, stage: assign, fault: http_429 }
  - { id: cursed_directory, endpoint: directory, stage: login, fault: http_500 }
reviews:
  label: Requester CSAT
  subscores: [first_response, resolution_time, reassignments, sla, ease]
  stages:
    first_response: [create, validate, triage, notify]
    resolution_time: [escalate, resolve]
    reassignments: [assign]
    sla: [sla]
    ease: [login, dedupe, close]
bosses:
  - { id: queue_lich, label: Queue Lich, hits: [create, assign, notify], story: "Tracker down while mail floods in" }
tiers:
  retry: "Retry tracker calls honouring Retry-After"
  journal: "Audit trail of every ticket step, replayed after a crash"
  idempotency: "Idempotency key is the external ticket id: one ticket, one notice"
  breaker: "Stop calling a failing tracker and probe before resuming"
  offline_queue: "Park requests and notices while a tracker is down"
`},B=A.streaming;class m extends Error{constructor(e,r){super(`line ${r}: ${e}`),this.line=r}line}function L(t){let e=null;for(let r=0;r<t.length;r++){const i=t[r];if(e){i===e&&(e=null);continue}if(i==='"'||i==="'")e=i;else if(i==="#"&&(r===0||/\s/.test(t[r-1])))return t.slice(0,r)}return t}function x(t){const e=[];let r=0,i=null,s="";for(const a of t){if(i){s+=a,a===i&&(i=null);continue}if(a==='"'||a==="'"){i=a,s+=a;continue}if((a==="["||a==="{")&&r++,(a==="]"||a==="}")&&r--,a===","&&r===0){e.push(s),s="";continue}s+=a}return s.trim()!==""&&e.push(s),e}function _(t){let e=null,r=0;for(let i=0;i<t.length;i++){const s=t[i];if(e){s===e&&(e=null);continue}if(s==='"'||s==="'")e=s;else if(s==="["||s==="{")r++;else if(s==="]"||s==="}")r--;else if(s===":"&&r===0&&(i===t.length-1||/\s/.test(t[i+1])))return i}return-1}function y(t,e){const r=t.trim();if(r===""||r==="~"||r==="null")return null;if(r==="true")return!0;if(r==="false")return!1;if(/^-?\d+(\.\d+)?$/.test(r))return Number(r);if(r[0]==='"'||r[0]==="'"){if(r.length<2||r[r.length-1]!==r[0])throw new m("unterminated string",e);return r.slice(1,-1)}if(r[0]==="["){if(r[r.length-1]!=="]")throw new m("unterminated flow list",e);return x(r.slice(1,-1)).map(i=>y(i,e))}if(r[0]==="{"){if(r[r.length-1]!=="}")throw new m("unterminated flow map",e);const i={};for(const s of x(r.slice(1,-1))){const a=_(s);if(a<0)throw new m(`bad flow map entry "${s.trim()}"`,e);i[String(y(s.slice(0,a),e))]=y(s.slice(a+1),e)}return i}return r}function T(t){const e=[];if(t.split(/\r?\n/).forEach((l,d)=>{if(/\t/.test(l.match(/^\s*/)[0]))throw new m("tabs are not allowed for indentation",d+1);const o=L(l).replace(/\s+$/,"");o.trim()!==""&&e.push({indent:o.length-o.trimStart().length,text:o.trim(),no:d+1})}),e.length===0)return null;let r=0;function i(l){const d=e[r];return d.text==="-"||d.text.startsWith("- ")?n(l):a(l)}function s(l,d,o){if(l!=="")return y(l,o);const p=e[r];return p&&p.indent>d?i(p.indent):null}function a(l,d){const o={},p=(u,k,D)=>{const $=_(u);if($<0)throw new m(`expected "key: value", got "${u}"`,k);const w=String(y(u.slice(0,$),k));if(w in o)throw new m(`duplicate key "${w}"`,k);o[w]=s(u.slice($+1).trim(),D,k)};for(d&&p(`${d.key}:${d.rest}`,d.no,l);r<e.length;){const u=e[r];if(u.indent<l)break;if(u.indent>l)throw new m("unexpected indentation",u.no);if(u.text.startsWith("- ")||u.text==="-")break;r++,p(u.text,u.no,l)}return o}function n(l){const d=[];for(;r<e.length;){const o=e[r];if(o.indent<l)break;if(o.indent>l)throw new m("unexpected indentation",o.no);if(!(o.text==="-"||o.text.startsWith("- ")))break;r++;const p=o.text.slice(1).trim();if(p===""){const u=e[r];d.push(u&&u.indent>l?i(u.indent):null)}else if(_(p)>=0&&p[0]!=="["&&p[0]!=="{"&&p[0]!=='"'&&p[0]!=="'"){const u=_(p),k=l+(o.text.length-o.text.slice(1).trimStart().length);d.push(a(k,{key:p.slice(0,u),rest:p.slice(u+1),no:o.no}))}else d.push(y(p,o.no))}return d}const f=i(e[0].indent);if(r<e.length)throw new m("unexpected content",e[r].no);return f}const F={rookie:{},retrier:{retry:!0},journaler:{retry:!0,journal:!0},reconciler:{retry:!0,journal:!0,idempotency:!0},phoenix:{retry:!0,journal:!0,idempotency:!0,breaker:!0,offline_queue:!0}},S=/^[A-Za-z0-9][A-Za-z0-9_-]*$/,c=t=>typeof t=="string"&&t.length>0,g=t=>typeof t=="object"&&t!==null&&!Array.isArray(t);function C(t){return t.stages.map(e=>({id:e.id,label:e.label,role:e.kind,...e.effects?{effects:e.effects.map(r=>({kind:r.kind,keyed:r.keyed}))}:{}}))}function M(t){const e=[];if(!g(t))return["pack: expected a map"];if((!c(t.id)||!/^[a-z0-9][a-z0-9_-]*$/.test(t.id))&&e.push("id: lowercase letters, digits, dash or underscore"),c(t.title)||e.push("title: required text"),!Array.isArray(t.stages)||t.stages.length===0)return e.push("stages: need at least one stage"),e;const r=new Set;t.stages.forEach((s,a)=>{const n=`stages[${a}]`;if(!g(s)){e.push(`${n}: expected a map`);return}!c(s.id)||!S.test(s.id)?e.push(`${n}.id: letters, digits, dash or underscore`):r.has(s.id)?e.push(`${n}.id: duplicate "${s.id}"`):r.add(s.id),v.includes(s.kind)||e.push(`${n}.kind: one of ${v.join(" | ")}`),c(s.label)||e.push(`${n}.label: required text`)});const i=new Set;if(!Array.isArray(t.faults)||t.faults.length===0?e.push("faults: need at least one fault"):t.faults.forEach((s,a)=>{const n=`faults[${a}]`;if(!g(s)){e.push(`${n}: expected a map`);return}!c(s.id)||!S.test(s.id)?e.push(`${n}.id: letters, digits, dash or underscore`):i.has(s.id)?e.push(`${n}.id: duplicate "${s.id}"`):i.add(s.id),s.stage!=="any"&&!(c(s.stage)&&r.has(s.stage))&&e.push(`${n}.stage: must be a declared stage id or "any"`),c(s.creature)||e.push(`${n}.creature: required text`),(!c(s.art)||!q.includes(s.art))&&e.push(`${n}.art: an existing creature id (${q.join(", ")})`),s.sprite!==void 0&&!(c(s.sprite)&&R.includes(s.sprite))&&e.push(`${n}.sprite: one of ${R.join(", ")}`),c(s.mode)||e.push(`${n}.mode: required text`),c(s.behavior)||e.push(`${n}.behavior: required text`)}),(!g(t.reviews)||!c(t.reviews.label)||!Array.isArray(t.reviews.subscores)||t.reviews.subscores.length===0||!t.reviews.subscores.every(c))&&e.push("reviews: need label and a list of subscores"),t.ledger!==void 0&&!(Array.isArray(t.ledger)&&t.ledger.every(s=>g(s)&&c(s.id)))&&e.push("ledger: list of {id}"),t.curses!==void 0&&(Array.isArray(t.curses)?t.curses.forEach((s,a)=>{const n=`curses[${a}]`;if(!g(s)||!c(s.id)||!c(s.endpoint)){e.push(`${n}: need id and endpoint`);return}s.stage!==void 0&&!(c(s.stage)&&r.has(s.stage))&&e.push(`${n}.stage: must be a declared stage id`),s.fault!==void 0&&!(c(s.fault)&&j.includes(s.fault))&&e.push(`${n}.fault: one of ${j.join(", ")}`)}):e.push("curses: list of {id, endpoint, stage?, fault?}")),g(t.reviews)&&t.reviews.stages!==void 0){const s=t.reviews.stages,a=Array.isArray(t.reviews.subscores)?t.reviews.subscores.map(String):[];if(!g(s))e.push("reviews.stages: map of subscore to stage ids");else for(const[n,f]of Object.entries(s))a.includes(n)?(!Array.isArray(f)||f.length===0||!f.every(l=>r.has(String(l))))&&e.push(`reviews.stages.${n}: list of declared stage ids`):e.push(`reviews.stages.${n}: not a declared subscore`)}if(t.bosses!==void 0&&(Array.isArray(t.bosses)?t.bosses.forEach((s,a)=>{if(!g(s)||!c(s.id)||!Array.isArray(s.hits)||s.hits.length===0){e.push(`bosses[${a}]: need id and hits`);return}for(const n of s.hits)r.has(String(n))||e.push(`bosses[${a}].hits: unknown stage "${String(n)}"`)}):e.push("bosses: expected a list")),!g(t.tiers))e.push("tiers: map of part to text");else for(const[s,a]of Object.entries(t.tiers))N.includes(s)?c(a)||e.push(`tiers.${s}: required text`):e.push(`tiers.${s}: unknown part`);return e.length===0&&e.push(...Z({name:`${String(t.id)}-lab`,stages:C(t)}).map(s=>`model: ${s}`)),e}function z(t){let e;try{e=T(t)}catch(s){return{ok:!1,errors:[s.message]}}const r=M(e);if(r.length)return{ok:!1,errors:r};const i=e;return{ok:!0,pack:{id:i.id,title:String(i.title),modelBased:i.modelBased!==!1,stages:C(i),ledger:i.ledger??[],faults:i.faults,curses:i.curses??[],reviews:i.reviews,bosses:i.bosses??[],tiers:i.tiers}}}function O(t){const e={};for(const r of t.faults)r.art in e||(e[r.art]=r.creature);return{id:t.id,title:t.title,modelBased:t.modelBased,creatures:e,review:t.reviews,tiers:t.tiers,faults:t.faults,bosses:t.bosses,curses:t.curses}}function I(t,e={}){return{name:`${t.id}-lab`,stages:t.stages.map(r=>({...r,...r.effects?{effects:r.effects.map(i=>({...i}))}:{}})),parts:{...e},pack:O(t)}}const N=["retry","journal","idempotency","breaker","offline_queue"],R=["buffer_wraith","cdn_kraken","drm_gatekeeper","render_gremlin","cloud_banshee","region_ghost"],q=["reaper","wraith","banshee","zombie","ghost","goblin","imp","poltergeist","doppelganger","witch","mummy"],j=["crash","power_outage","internet_outage","timeout","http_404","http_429","http_500","missing_file","duplicate_request","malformed_payload","disk_full"],v=["input","work","effect","poll","final"];function G(t){const e=t.parts??{};return{retry:!!e.retry,journal:!!e.journal,idempotency:!!e.idempotency,breaker:!!e.breaker,offline_queue:!!e.offline_queue}}function Z(t){const e=[];if(typeof t!="object"||t===null)return["model: expected an object"];const r=t;if((typeof r.name!="string"||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(r.name))&&e.push("name: letters, digits, dot, dash or underscore"),!Array.isArray(r.stages)||r.stages.length===0)return e.push("stages: need at least one stage"),e;r.stages.length>24&&e.push("stages: at most 24");const i=new Set;return r.stages.forEach((s,a)=>{const n=`stages[${a}]`;if(typeof s!="object"||s===null){e.push(`${n}: expected an object`);return}const f=s;typeof f.id!="string"||!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(f.id)?e.push(`${n}.id: letters, digits, dash or underscore`):i.has(f.id)?e.push(`${n}.id: duplicate "${f.id}"`):i.add(f.id),v.includes(f.role)||e.push(`${n}.role: one of ${v.join(" | ")}`),f.effects!==void 0&&(Array.isArray(f.effects)?(f.effects.length>0&&f.role!=="effect"&&e.push(`${n}.effects: only on role "effect"`),f.effects.forEach((l,d)=>{const o=l;(!o||typeof o.kind!="string"||!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(o.kind))&&e.push(`${n}.effects[${d}].kind: letters, digits, dash or underscore`),(!o||typeof o.keyed!="boolean")&&e.push(`${n}.effects[${d}].keyed: true or false`)})):e.push(`${n}.effects: expected a list`))}),e}function W(t){const e=t.stages.map(r=>({id:r.id,label:r.label?.trim()||r.id,role:r.role,effects:r.role==="effect"?(r.effects??[]).map(i=>({kind:i.kind,key:i.kind,idempotent:i.keyed?"required":"preferred"})):[]}));return{name:t.name,start:"node dist/bot.js",adapter:["sdk"],stages:e,...t.stages.some(r=>r.role==="input")?{inputs:"./inputs/"}:{},...t.stages.some(r=>r.role==="effect")?{truth:"http://127.0.0.1:7071"}:{},targets:{recoverMs:2e4,repeats:0,concurrency:8}}}const b=t=>/^[A-Za-z0-9_./:-]+$/.test(t)?t:JSON.stringify(t);function Y(t){const e=W(t),r=[`name: ${b(e.name)}`,`start: ${b(e.start)}`,"adapter: sdk"];e.inputs&&r.push(`inputs: ${b(e.inputs)}`),e.truth&&r.push(`truth: ${b(e.truth)}`),r.push("targets:",`  recoverMs: ${e.targets.recoverMs}`,`  repeats: ${e.targets.repeats}`,`  concurrency: ${e.targets.concurrency}`,"stages:");for(const i of e.stages)if(r.push(`  - id: ${b(i.id)}`,`    label: ${b(i.label)}`,`    role: ${i.role}`),i.effects.length){r.push("    effects:");for(const s of i.effects)r.push(`      - { kind: ${b(s.kind)}, key: ${b(s.key)}, idempotent: ${s.idempotent} }`)}return r.join(`
`)+`
`}function H(t){return{name:t.name,stages:t.stages.map(e=>({id:e.id,label:e.label,role:e.role,...e.role==="effect"?{effects:e.effects.map(r=>({kind:r.kind,keyed:r.idempotent==="required"}))}:{}}))}}const h=(t,e=!1)=>({kind:t,keyed:e}),E={orders:{name:"orders-lab",stages:[{id:"account",label:"Account or login",role:"effect",effects:[h("account")]},{id:"create",label:"Create order",role:"input"},{id:"submit",label:"Submit order",role:"effect",effects:[h("order")]},{id:"payment",label:"Payment",role:"effect",effects:[h("charge")]},{id:"confirmation",label:"Confirmation",role:"effect",effects:[h("email")]},{id:"receive",label:"Store receives",role:"effect",effects:[h("store")]},{id:"process",label:"Process order",role:"effect",effects:[h("store")]},{id:"ship",label:"Ship and pack",role:"effect",effects:[h("dispatch")]},{id:"transit",label:"Delivery updates",role:"poll"}]},inbox:{name:"inbox-lab",stages:[{id:"fetch",label:"Fetch mail",role:"input"},{id:"classify",label:"Classify",role:"work"},{id:"reply",label:"Send reply",role:"effect",effects:[h("reply")]},{id:"archive",label:"Archive",role:"final"}]},payments:{name:"payments-lab",stages:[{id:"receive",label:"Receive batch",role:"input"},{id:"validate",label:"Validate",role:"work"},{id:"charge",label:"Charge card",role:"effect",effects:[h("charge")]},{id:"ledger",label:"Write ledger",role:"effect",effects:[h("ledger")]},{id:"settle",label:"Wait for settlement",role:"poll"}]},get streaming(){return P(B)},report:{name:"report-lab",stages:[{id:"pull",label:"Pull data",role:"input"},{id:"build",label:"Build report",role:"work"},{id:"publish",label:"Publish",role:"effect",effects:[h("publish")]},{id:"notify",label:"Notify owners",role:"final"}]}};for(const t of Object.keys(A))t in E||Object.defineProperty(E,t,{enumerable:!0,configurable:!0,get:()=>P(A[t])});const K=["npm run haunt -- init","npm run haunt -- validate","npm run haunt -- sweep"];function Q(t){const e=t.pack?.id;return e?[`npm run haunt -- init --pack ${e}`,`npm run haunt -- pack check ${e}`,"npm run haunt -- validate","npm run haunt -- sweep"]:K}function P(t){const e=z(t);if(!e.ok)throw new Error(`embedded pack is invalid: ${e.errors.join("; ")}`);return I(e.pack)}export{A as E,E as L,F as P,v as R,m as Y,N as a,Y as b,H as c,T as d,z as e,Q as l,G as p,Z as v};
