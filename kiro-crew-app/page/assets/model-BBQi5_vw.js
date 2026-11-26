import{p as w}from"./yaml-ZQ7op-oi.js";const g={streaming:`# Streaming service pack. Model-based demo: results come from rules over declared protections, not real code.
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
`},S=g.streaming,L={rookie:{},retrier:{retry:!0},journaler:{retry:!0,journal:!0},reconciler:{retry:!0,journal:!0,idempotency:!0},phoenix:{retry:!0,journal:!0,idempotency:!0,breaker:!0,offline_queue:!0}},m=/^[A-Za-z0-9][A-Za-z0-9_-]*$/,n=t=>typeof t=="string"&&t.length>0,c=t=>typeof t=="object"&&t!==null&&!Array.isArray(t);function $(t){return t.stages.map(e=>({id:e.id,label:e.label,role:e.kind,...e.effects?{effects:e.effects.map(s=>({kind:s.kind,keyed:s.keyed}))}:{}}))}function R(t){const e=[];if(!c(t))return["pack: expected a map"];if((!n(t.id)||!/^[a-z0-9][a-z0-9_-]*$/.test(t.id))&&e.push("id: lowercase letters, digits, dash or underscore"),n(t.title)||e.push("title: required text"),!Array.isArray(t.stages)||t.stages.length===0)return e.push("stages: need at least one stage"),e;const s=new Set;t.stages.forEach((r,d)=>{const i=`stages[${d}]`;if(!c(r)){e.push(`${i}: expected a map`);return}!n(r.id)||!m.test(r.id)?e.push(`${i}.id: letters, digits, dash or underscore`):s.has(r.id)?e.push(`${i}.id: duplicate "${r.id}"`):s.add(r.id),p.includes(r.kind)||e.push(`${i}.kind: one of ${p.join(" | ")}`),n(r.label)||e.push(`${i}.label: required text`)});const a=new Set;if(!Array.isArray(t.faults)||t.faults.length===0?e.push("faults: need at least one fault"):t.faults.forEach((r,d)=>{const i=`faults[${d}]`;if(!c(r)){e.push(`${i}: expected a map`);return}!n(r.id)||!m.test(r.id)?e.push(`${i}.id: letters, digits, dash or underscore`):a.has(r.id)?e.push(`${i}.id: duplicate "${r.id}"`):a.add(r.id),r.stage!=="any"&&!(n(r.stage)&&s.has(r.stage))&&e.push(`${i}.stage: must be a declared stage id or "any"`),n(r.creature)||e.push(`${i}.creature: required text`),(!n(r.art)||!y.includes(r.art))&&e.push(`${i}.art: an existing creature id (${y.join(", ")})`),r.sprite!==void 0&&!(n(r.sprite)&&k.includes(r.sprite))&&e.push(`${i}.sprite: one of ${k.join(", ")}`),n(r.mode)||e.push(`${i}.mode: required text`),n(r.behavior)||e.push(`${i}.behavior: required text`)}),(!c(t.reviews)||!n(t.reviews.label)||!Array.isArray(t.reviews.subscores)||t.reviews.subscores.length===0||!t.reviews.subscores.every(n))&&e.push("reviews: need label and a list of subscores"),t.ledger!==void 0&&!(Array.isArray(t.ledger)&&t.ledger.every(r=>c(r)&&n(r.id)))&&e.push("ledger: list of {id}"),t.curses!==void 0&&(Array.isArray(t.curses)?t.curses.forEach((r,d)=>{const i=`curses[${d}]`;if(!c(r)||!n(r.id)||!n(r.endpoint)){e.push(`${i}: need id and endpoint`);return}r.stage!==void 0&&!(n(r.stage)&&s.has(r.stage))&&e.push(`${i}.stage: must be a declared stage id`),r.fault!==void 0&&!(n(r.fault)&&_.includes(r.fault))&&e.push(`${i}.fault: one of ${_.join(", ")}`)}):e.push("curses: list of {id, endpoint, stage?, fault?}")),c(t.reviews)&&t.reviews.stages!==void 0){const r=t.reviews.stages,d=Array.isArray(t.reviews.subscores)?t.reviews.subscores.map(String):[];if(!c(r))e.push("reviews.stages: map of subscore to stage ids");else for(const[i,o]of Object.entries(r))d.includes(i)?(!Array.isArray(o)||o.length===0||!o.every(h=>s.has(String(h))))&&e.push(`reviews.stages.${i}: list of declared stage ids`):e.push(`reviews.stages.${i}: not a declared subscore`)}if(t.bosses!==void 0&&(Array.isArray(t.bosses)?t.bosses.forEach((r,d)=>{if(!c(r)||!n(r.id)||!Array.isArray(r.hits)||r.hits.length===0){e.push(`bosses[${d}]: need id and hits`);return}for(const i of r.hits)s.has(String(i))||e.push(`bosses[${d}].hits: unknown stage "${String(i)}"`)}):e.push("bosses: expected a list")),!c(t.tiers))e.push("tiers: map of part to text");else for(const[r,d]of Object.entries(t.tiers))C.includes(r)?n(d)||e.push(`tiers.${r}: required text`):e.push(`tiers.${r}: unknown part`);return e.length===0&&e.push(...E({name:`${String(t.id)}-lab`,stages:$(t)}).map(r=>`model: ${r}`)),e}function j(t){let e;try{e=w(t)}catch(r){return{ok:!1,errors:[r.message]}}const s=R(e);if(s.length)return{ok:!1,errors:s};const a=e;return{ok:!0,pack:{id:a.id,title:String(a.title),modelBased:a.modelBased!==!1,stages:$(a),ledger:a.ledger??[],faults:a.faults,curses:a.curses??[],reviews:a.reviews,bosses:a.bosses??[],tiers:a.tiers}}}function x(t){const e={};for(const s of t.faults)s.art in e||(e[s.art]=s.creature);return{id:t.id,title:t.title,modelBased:t.modelBased,creatures:e,review:t.reviews,tiers:t.tiers,faults:t.faults,bosses:t.bosses,curses:t.curses}}function q(t,e={}){return{name:`${t.id}-lab`,stages:t.stages.map(s=>({...s,...s.effects?{effects:s.effects.map(a=>({...a}))}:{}})),parts:{...e},pack:x(t)}}const C=["retry","journal","idempotency","breaker","offline_queue"],k=["buffer_wraith","cdn_kraken","drm_gatekeeper","render_gremlin","cloud_banshee","region_ghost"],y=["reaper","wraith","banshee","zombie","ghost","goblin","imp","poltergeist","doppelganger","witch","mummy"],_=["crash","power_outage","internet_outage","timeout","http_404","http_429","http_500","missing_file","duplicate_request","malformed_payload","disk_full"],p=["input","work","effect","poll","final"];function T(t){const e=t.parts??{};return{retry:!!e.retry,journal:!!e.journal,idempotency:!!e.idempotency,breaker:!!e.breaker,offline_queue:!!e.offline_queue}}function E(t){const e=[];if(typeof t!="object"||t===null)return["model: expected an object"];const s=t;if((typeof s.name!="string"||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s.name))&&e.push("name: letters, digits, dot, dash or underscore"),!Array.isArray(s.stages)||s.stages.length===0)return e.push("stages: need at least one stage"),e;s.stages.length>24&&e.push("stages: at most 24");const a=new Set;return s.stages.forEach((r,d)=>{const i=`stages[${d}]`;if(typeof r!="object"||r===null){e.push(`${i}: expected an object`);return}const o=r;typeof o.id!="string"||!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(o.id)?e.push(`${i}.id: letters, digits, dash or underscore`):a.has(o.id)?e.push(`${i}.id: duplicate "${o.id}"`):a.add(o.id),p.includes(o.role)||e.push(`${i}.role: one of ${p.join(" | ")}`),o.effects!==void 0&&(Array.isArray(o.effects)?(o.effects.length>0&&o.role!=="effect"&&e.push(`${i}.effects: only on role "effect"`),o.effects.forEach((h,b)=>{const f=h;(!f||typeof f.kind!="string"||!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(f.kind))&&e.push(`${i}.effects[${b}].kind: letters, digits, dash or underscore`),(!f||typeof f.keyed!="boolean")&&e.push(`${i}.effects[${b}].keyed: true or false`)})):e.push(`${i}.effects: expected a list`))}),e}function P(t){const e=t.stages.map(s=>({id:s.id,label:s.label?.trim()||s.id,role:s.role,effects:s.role==="effect"?(s.effects??[]).map(a=>({kind:a.kind,key:a.kind,idempotent:a.keyed?"required":"preferred"})):[]}));return{name:t.name,start:"node dist/bot.js",adapter:["sdk"],stages:e,...t.stages.some(s=>s.role==="input")?{inputs:"./inputs/"}:{},...t.stages.some(s=>s.role==="effect")?{truth:"http://127.0.0.1:7071"}:{},targets:{recoverMs:2e4,repeats:0,concurrency:8}}}const u=t=>/^[A-Za-z0-9_./:-]+$/.test(t)?t:JSON.stringify(t);function M(t){const e=P(t),s=[`name: ${u(e.name)}`,`start: ${u(e.start)}`,"adapter: sdk"];e.inputs&&s.push(`inputs: ${u(e.inputs)}`),e.truth&&s.push(`truth: ${u(e.truth)}`),s.push("targets:",`  recoverMs: ${e.targets.recoverMs}`,`  repeats: ${e.targets.repeats}`,`  concurrency: ${e.targets.concurrency}`,"stages:");for(const a of e.stages)if(s.push(`  - id: ${u(a.id)}`,`    label: ${u(a.label)}`,`    role: ${a.role}`),a.effects.length){s.push("    effects:");for(const r of a.effects)s.push(`      - { kind: ${u(r.kind)}, key: ${u(r.key)}, idempotent: ${r.idempotent} }`)}return s.join(`
`)+`
`}function z(t){return{name:t.name,stages:t.stages.map(e=>({id:e.id,label:e.label,role:e.role,...e.role==="effect"?{effects:e.effects.map(s=>({kind:s.kind,keyed:s.idempotent==="required"}))}:{}}))}}const l=(t,e=!1)=>({kind:t,keyed:e}),v={orders:{name:"orders-lab",stages:[{id:"account",label:"Account or login",role:"effect",effects:[l("account")]},{id:"create",label:"Create order",role:"input"},{id:"submit",label:"Submit order",role:"effect",effects:[l("order")]},{id:"payment",label:"Payment",role:"effect",effects:[l("charge")]},{id:"confirmation",label:"Confirmation",role:"effect",effects:[l("email")]},{id:"receive",label:"Store receives",role:"effect",effects:[l("store")]},{id:"process",label:"Process order",role:"effect",effects:[l("store")]},{id:"ship",label:"Ship and pack",role:"effect",effects:[l("dispatch")]},{id:"transit",label:"Delivery updates",role:"poll"}]},inbox:{name:"inbox-lab",stages:[{id:"fetch",label:"Fetch mail",role:"input"},{id:"classify",label:"Classify",role:"work"},{id:"reply",label:"Send reply",role:"effect",effects:[l("reply")]},{id:"archive",label:"Archive",role:"final"}]},payments:{name:"payments-lab",stages:[{id:"receive",label:"Receive batch",role:"input"},{id:"validate",label:"Validate",role:"work"},{id:"charge",label:"Charge card",role:"effect",effects:[l("charge")]},{id:"ledger",label:"Write ledger",role:"effect",effects:[l("ledger")]},{id:"settle",label:"Wait for settlement",role:"poll"}]},get streaming(){return A(S)},report:{name:"report-lab",stages:[{id:"pull",label:"Pull data",role:"input"},{id:"build",label:"Build report",role:"work"},{id:"publish",label:"Publish",role:"effect",effects:[l("publish")]},{id:"notify",label:"Notify owners",role:"final"}]}};for(const t of Object.keys(g))t in v||Object.defineProperty(v,t,{enumerable:!0,configurable:!0,get:()=>A(g[t])});const D=["npm run haunt -- init","npm run haunt -- validate","npm run haunt -- sweep"];function O(t){const e=t.pack?.id;return e?[`npm run haunt -- init --pack ${e}`,`npm run haunt -- pack check ${e}`,"npm run haunt -- validate","npm run haunt -- sweep"]:D}function A(t){const e=j(t);if(!e.ok)throw new Error(`embedded pack is invalid: ${e.errors.join("; ")}`);return q(e.pack)}export{g as E,C as L,L as P,p as R,M as a,v as b,z as c,j as d,O as l,T as p,E as v};
