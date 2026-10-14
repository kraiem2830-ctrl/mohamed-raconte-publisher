// Mohamed Raconte Publisher — interface de planification.
// Tout passe par l'API GitHub depuis le navigateur : schedule.json et config.json du dépôt privé,
// vidéos dans la release « videos », publication déclenchée par le workflow publish.yml.
// Mode démo (?demo=1) : données fictives locales, rien n'est envoyé.
"use strict";

const REPO = "kraiem2830-ctrl/publisher";
const BRANCH = "main";
const RELEASE_TAG = "videos";
const WORKFLOW = "publish.yml";
const SLOTS = ["12:30", "19:00"];
const ICON = { done: "✅", pending: "⏳", error: "❌", external: "📅", off: "—", manual: "✋" };
const LABEL = { done: "publié", pending: "automatique", error: "erreur", external: "programmé dans l'appli", off: "désactivé", manual: "à la main" };
const PRIVACY = [["PUBLIC_TO_EVERYONE", "Public"], ["MUTUAL_FOLLOW_FRIENDS", "Amis"], ["FOLLOWER_OF_CREATOR", "Abonnés"], ["SELF_ONLY", "Privé (moi seulement)"]];
const DOW = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const DOW_SHORT = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

const state = {
  token: null, demo: new URLSearchParams(location.search).get("demo") === "1",
  cfg: null, items: [], sha: null, release: null, runs: [],
  view: "week", cursor: new Date(), filter: null,
};

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const startOfWeek = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmtDate = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toLocalISO = (d) => {
  const o = -d.getTimezoneOffset(), s = o >= 0 ? "+" : "-", a = Math.abs(o);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
};
const b64utf8 = (s) => { const b = new TextEncoder().encode(s); let out = ""; for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(out); };
const utf8b64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0)));

function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = "toast " + kind; t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), kind === "error" ? 9000 : 4500);
}

// ── API GitHub ─────────────────────────────────────────────────────────────
async function gh(path, opts = {}) {
  const r = await fetch(path.startsWith("http") ? path : "https://api.github.com" + path, {
    ...opts,
    headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + state.token, "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
  });
  if (!r.ok) {
    let detail = ""; try { detail = (await r.json()).message || ""; } catch (e) { /* vide */ }
    throw new Error(`GitHub ${r.status} ${path.split("?")[0]} ${detail}`.trim());
  }
  return r.status === 204 ? null : r.json();
}

async function readJson(file) {
  if (state.demo) return { data: await (await fetch(`demo/${file}`)).json(), sha: "demo" };
  const c = await gh(`/repos/${REPO}/contents/${file}?ref=${BRANCH}`);
  return { data: JSON.parse(utf8b64(c.content)), sha: c.sha };
}

async function writeSchedule(items, message) {
  items.sort((a, b) => (a.account || "islam").localeCompare(b.account || "islam") || (a.at == null) - (b.at == null) || String(a.at || "").localeCompare(String(b.at || "")) || a.id.localeCompare(b.id));
  const text = JSON.stringify(items, null, 1) + "\n";
  if (state.demo) { state.items = items; return; }
  const body = { message, content: b64utf8(text), sha: state.sha, branch: BRANCH };
  try {
    const r = await gh(`/repos/${REPO}/contents/schedule.json`, { method: "PUT", body: JSON.stringify(body) });
    state.sha = r.content.sha; state.items = items;
  } catch (e) {
    if (!/409|422/.test(e.message)) throw e;
    // le planning a bougé (passage automatique) : on recharge et on réapplique
    const fresh = await readJson("schedule.json");
    const mine = new Map(items.map((x) => [`${x.account}/${x.id}`, x]));
    const merged = fresh.data.filter((x) => mine.has(`${x.account}/${x.id}`) || !state.items.some((o) => o.account === x.account && o.id === x.id));
    for (const x of items) if (!merged.some((m) => m.account === x.account && m.id === x.id)) merged.push(x);
    state.sha = fresh.sha;
    await writeSchedule(merged.map((m) => mine.get(`${m.account}/${m.id}`) || m), message);
  }
}

async function loadRelease() {
  if (state.demo) return { id: 0, assets: state.items.map((x) => ({ id: 0, name: x.video, size: 9e6 })) };
  try { return await gh(`/repos/${REPO}/releases/tags/${RELEASE_TAG}`); }
  catch (e) { if (/404/.test(e.message)) return await gh(`/repos/${REPO}/releases`, { method: "POST", body: JSON.stringify({ tag_name: RELEASE_TAG, name: "Vidéos à publier", body: "Stock des vidéos lues par publish.py" }) }); throw e; }
}

async function uploadVideo(file, name, onProgress) {
  if (state.demo) { for (let p = 0; p <= 100; p += 20) { onProgress(p); await new Promise((r) => setTimeout(r, 120)); } return; }
  const rel = state.release || (state.release = await loadRelease());
  const old = (rel.assets || []).find((a) => a.name === name);
  if (old) await gh(`/repos/${REPO}/releases/assets/${old.id}`, { method: "DELETE" });
  await new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", `https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`);
    x.setRequestHeader("Authorization", "Bearer " + state.token);
    x.setRequestHeader("Content-Type", "video/mp4");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    x.onload = () => (x.status < 300 ? resolve() : reject(new Error(`Envoi refusé (${x.status})`)));
    x.onerror = () => reject(new Error("Envoi interrompu"));
    x.send(file);
  });
  state.release = await loadRelease();
}

async function loadRuns() {
  if (state.demo) return [{ status: "completed", conclusion: "success", created_at: new Date().toISOString(), html_url: "#" }];
  try { return (await gh(`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=5`)).workflow_runs || []; } catch (e) { return []; }
}

async function loadAll() {
  const [cfg, sch] = await Promise.all([readJson("config.json"), readJson("schedule.json")]);
  state.cfg = cfg.data; state.items = sch.data; state.sha = sch.sha;
  state.runs = await loadRuns();
  state.release = null;
  render();
}

// ── rendu ──────────────────────────────────────────────────────────────────
const accounts = () => state.cfg.accounts || {};
const acc = (key) => accounts()[key] || { name: key };
const avatar = (key) => `avatars/${esc(key)}.png`;
const visibleItems = () => state.items.filter((x) => !state.filter || (x.account || "islam") === state.filter);

function statusOf(item, net) {
  const a = acc(item.account || "islam");
  const p = item[net];
  if (!a[net] || !p) return null;
  const s = p.status || "pending";
  if (s === "pending" && !a[`${net}_enabled`]) return "manual";
  return s;
}

function statusBadges(item) {
  return ["tiktok", "instagram"].map((net) => {
    const s = statusOf(item, net); if (!s) return "";
    const p = item[net] || {};
    const label = `${net === "tiktok" ? "TikTok" : "Instagram"} : ${LABEL[s]}${p.error ? " — " + p.error : ""}`;
    const icon = s === "done" && p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" title="${esc(label)}">${ICON[s]} voir</a>` : `<span title="${esc(label)}">${ICON[s]}</span>`;
    return `<span class="net">${net === "tiktok" ? "♪" : "◎"} ${icon}</span>`;
  }).join("");
}

function postCard(item) {
  const d = new Date(item.at);
  const k = item.account || "islam";
  const cls = ["tiktok", "instagram"].some((n) => statusOf(item, n) === "error") ? "err" : ["tiktok", "instagram"].every((n) => !statusOf(item, n) || ["done", "external", "off"].includes(statusOf(item, n))) ? "done" : "";
  return `<div class="post ${cls}" data-id="${esc(item.id)}" data-account="${esc(k)}">
    <img src="${avatar(k)}" alt="">
    <div><div class="t"><span>${fmtTime(d)}</span><span>${esc(acc(k).name)}</span></div>
      <div class="title">${esc(item.title || item.caption || item.video)}</div>
      <div class="st">${statusBadges(item)}</div></div></div>`;
}

function renderChannels() {
  const run = state.runs[0];
  $("#channels").innerHTML = Object.entries(accounts()).map(([k, a]) => `
    <button class="channel ${state.filter === k ? "active" : ""}" data-key="${esc(k)}">
      <img src="${avatar(k)}" alt="">
      <div><div class="name">${esc(a.name)}</div>
        <div class="nets">
          ${a.tiktok ? `<span class="net"><i class="dot ${a.tiktok_enabled ? "on" : "wait"}"></i>${esc(a.tiktok)}</span>` : ""}
          ${a.instagram ? `<span class="net"><i class="dot ${a.instagram_enabled ? "on" : "wait"}"></i>${esc(a.instagram)}</span>` : ""}
        </div></div></button>`).join("");
  $("#last-run").innerHTML = run
    ? `Dernier passage : <a href="${esc(run.html_url)}" target="_blank" rel="noopener">${run.status === "completed" ? (run.conclusion === "success" ? "✅" : "❌") : "⏳"} ${new Date(run.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</a>`
    : "Dernier passage : —";
  $("#brand-sub").textContent = state.demo ? "démonstration" : REPO;
  $("#actions-link").href = `https://github.com/${REPO}/actions`;
  $("#planning-link").href = `https://github.com/${REPO}/blob/${BRANCH}/PLANNING.md`;
}

function renderWeek() {
  const start = startOfWeek(state.cursor), now = new Date();
  $("#range").textContent = `${fmtDate(start)} – ${fmtDate(addDays(start, 6))}`;
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  $("#content").innerHTML = `<div class="week">${days.map((d, i) => {
    const posts = visibleItems().filter((x) => x.at && sameDay(new Date(x.at), d)).sort((a, b) => a.at.localeCompare(b.at));
    return `<div class="day ${sameDay(d, now) ? "today" : ""} ${d < startOfWeek(now) ? "past" : ""}" data-date="${d.toISOString()}">
      <div class="day-head"><span class="dow">${DOW[i]}</span><span class="num">${fmtDate(d)}</span></div>
      <div class="day-body">${posts.map(postCard).join("")}</div>
      <button class="btn ghost sm add" data-date="${d.toISOString()}">＋ ajouter</button></div>`;
  }).join("")}</div>`;
}

function renderMonth() {
  const c = state.cursor, first = new Date(c.getFullYear(), c.getMonth(), 1), now = new Date();
  $("#range").textContent = first.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const start = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  $("#content").innerHTML = `<div class="month">${DOW_SHORT.map((d) => `<div class="dow">${d}</div>`).join("")}${cells.map((d) => {
    const posts = visibleItems().filter((x) => x.at && sameDay(new Date(x.at), d)).sort((a, b) => a.at.localeCompare(b.at));
    return `<div class="mday ${d.getMonth() !== c.getMonth() ? "other" : ""} ${sameDay(d, now) ? "today" : ""}" data-date="${d.toISOString()}">
      <div class="num">${d.getDate()}</div>
      ${posts.slice(0, 3).map((x) => `<div class="chip" data-id="${esc(x.id)}" data-account="${esc(x.account || "islam")}"><img src="${avatar(x.account || "islam")}" alt="">${fmtTime(new Date(x.at))} ${esc(x.title || x.video)}</div>`).join("")}
      ${posts.length > 3 ? `<div class="more">+${posts.length - 3}</div>` : ""}</div>`;
  }).join("")}</div>`;
}

function renderList() {
  $("#range").textContent = `${visibleItems().length} vidéo(s)`;
  const rows = [...visibleItems()].sort((a, b) => (a.at == null) - (b.at == null) || String(a.at || "").localeCompare(String(b.at || "")));
  $("#content").innerHTML = `<table class="list"><thead><tr><th>Quand</th><th>Compte</th><th>Vidéo</th><th>TikTok</th><th>Instagram</th></tr></thead><tbody>${rows.map((x) => {
    const k = x.account || "islam", d = x.at ? new Date(x.at) : null;
    const cell = (net) => { const s = statusOf(x, net); if (!s) return "—"; const p = x[net] || {}; return s === "done" && p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">✅ voir</a>` : `<span title="${esc(p.error || "")}">${ICON[s]} ${LABEL[s]}</span>`; };
    return `<tr data-id="${esc(x.id)}" data-account="${esc(k)}"><td>${d ? `${DOW_SHORT[(d.getDay() + 6) % 7]} ${fmtDate(d)} ${fmtTime(d)}` : "<span class='muted'>à programmer</span>"}</td><td><img src="${avatar(k)}" alt="">${esc(acc(k).name)}</td><td>${esc(x.title || x.video)}<div class="small muted">${esc(x.video)}</div></td><td>${cell("tiktok")}</td><td>${cell("instagram")}</td></tr>`;
  }).join("")}</tbody></table>`;
}

function render() {
  renderChannels();
  $("#views").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));
  ({ week: renderWeek, month: renderMonth, list: renderList })[state.view]();
}

// ── fenêtre de création / modification ─────────────────────────────────────
function nextSlot(from) {
  const taken = new Set(state.items.filter((x) => x.at).map((x) => x.at.slice(0, 16)));
  const d = new Date(from); d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 365; i++) {
    for (const s of SLOTS) {
      const [h, m] = s.split(":").map(Number); const c = new Date(d); c.setHours(h, m, 0, 0);
      if (c > new Date() && !taken.has(toLocalISO(c).slice(0, 16))) return c;
    }
    d.setDate(d.getDate() + 1);
  }
  return new Date();
}

function openEditor(item, presetDate) {
  const isNew = !item;
  const keys = Object.keys(accounts());
  const it = item ? JSON.parse(JSON.stringify(item)) : { id: Date.now().toString(36), account: state.filter || keys[0], at: null, title: "", caption: "", video: "", tiktok: { status: "pending" }, instagram: { status: "pending" } };
  const when = it.at ? new Date(it.at) : nextSlot(presetDate || new Date());
  const a = acc(it.account);
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true">
    <header><h2>${isNew ? "Nouvelle publication" : "Modifier la publication"}</h2><button class="btn ghost sm" data-close>✕</button></header>
    <div class="body">
      <div class="cols">
        <div class="field"><label>Compte</label><select id="f-account" ${isNew ? "" : "disabled"}>${keys.map((k) => `<option value="${esc(k)}" ${k === it.account ? "selected" : ""}>${esc(acc(k).name)}</option>`).join("")}</select></div>
        <div class="field"><label>Vidéo (MP4)</label><div class="file"><input type="file" id="f-file" accept="video/mp4,video/quicktime"><span class="small" id="f-video">${it.video ? esc(it.video) + " (déjà envoyée)" : "aucune"}</span></div><div class="progress hidden" id="f-progress"><div></div></div></div>
      </div>
      <div class="field"><label>Légende (la première ligne sert de titre)</label><textarea id="f-caption" placeholder="Titre accrocheur…&#10;&#10;Description, sources, #hashtags">${esc(it.caption)}</textarea><div class="counter" id="f-count"></div></div>
      <div class="cols">
        <div class="field"><label>Date</label><input type="date" id="f-date" value="${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}"></div>
        <div class="field"><label>Heure</label><input type="time" id="f-time" value="${fmtTime(when)}" step="300"></div>
      </div>
      <div class="field"><label>Réseaux</label><div class="checks" id="f-nets"></div></div>
      <div class="field"><label>Confidentialité TikTok</label><select id="f-privacy">${PRIVACY.map(([v, l]) => `<option value="${v}" ${(it.tiktok_privacy || state.cfg.tiktok_privacy || "PUBLIC_TO_EVERYONE") === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="status-line" id="f-status"></div>
    </div>
    <footer>${isNew ? "" : `<button class="btn danger" id="f-delete">Supprimer</button>`}<span class="spacer"></span><button class="btn" data-close>Annuler</button><button class="btn primary" id="f-save">${isNew ? "Programmer" : "Enregistrer"}</button></footer>
  </div></div>`;

  const nets = () => {
    const k = $("#f-account").value, ac = acc(k);
    $("#f-nets").innerHTML = ["tiktok", "instagram"].map((n) => ac[n] ? `<label><input type="checkbox" id="f-${n}" ${((it[n] || {}).status || "pending") !== "off" ? "checked" : ""}> ${n === "tiktok" ? "TikTok" : "Instagram"} <span class="muted small">${esc(ac[n])}${ac[`${n}_enabled`] ? "" : " · publication à la main (API en attente)"}</span></label>` : "").join("") || "<span class='muted'>aucun réseau configuré pour ce compte</span>";
    $("#f-status").innerHTML = ["tiktok", "instagram"].map((n) => { const s = statusOf(it, n); return s ? `<span>${n === "tiktok" ? "TikTok" : "Instagram"} : ${ICON[s]} ${LABEL[s]}${(it[n] || {}).error ? " — " + esc(it[n].error) : ""}</span>` : ""; }).join("");
  };
  nets();
  $("#f-account").onchange = nets;
  const count = () => { $("#f-count").textContent = `${$("#f-caption").value.length} caractères`; };
  count(); $("#f-caption").oninput = count;
  root.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => (root.innerHTML = "")));
  root.querySelector(".modal-back").onclick = (e) => { if (e.target === e.currentTarget) root.innerHTML = ""; };

  if (!isNew) $("#f-delete").onclick = async () => {
    if (!confirm("Retirer cette vidéo du planning ? (le fichier reste dans la release)")) return;
    try { await writeSchedule(state.items.filter((x) => !(x.account === it.account && x.id === it.id)), `Retrait ${it.account}/${it.id} (interface)`); root.innerHTML = ""; toast("Retirée du planning"); render(); }
    catch (e) { toast(e.message, "error"); }
  };

  $("#f-save").onclick = async () => {
    const btn = $("#f-save"); btn.disabled = true;
    try {
      const k = $("#f-account").value; it.account = k;
      const caption = $("#f-caption").value.trim();
      if (!caption) throw new Error("Il manque la légende.");
      const file = $("#f-file").files[0];
      if (!file && !it.video) throw new Error("Il manque la vidéo.");
      const [y, mo, d] = $("#f-date").value.split("-").map(Number), [h, mi] = $("#f-time").value.split(":").map(Number);
      const when = new Date(y, mo - 1, d, h, mi, 0, 0);
      if (isNaN(when)) throw new Error("Date ou heure invalide.");
      it.caption = caption; it.title = caption.split("\n")[0].slice(0, 80); it.at = toLocalISO(when);
      it.tiktok_privacy = $("#f-privacy").value;
      for (const n of ["tiktok", "instagram"]) {
        const box = $(`#f-${n}`);
        if (!box) { it[n] = { status: "off" }; continue; }
        const cur = it[n] || {};
        if (!box.checked) it[n] = { status: "off" };
        else if (cur.status === "off" || !cur.status) it[n] = { status: "pending" };
        else if (cur.status === "error") it[n] = { status: "pending" };
      }
      if (file) {
        it.video = `${k}-${it.id}.mp4`;
        const bar = $("#f-progress"); bar.classList.remove("hidden");
        await uploadVideo(file, it.video, (p) => { bar.firstElementChild.style.transform = `scaleX(${p / 100})`; $("#f-video").textContent = `envoi… ${p} %`; });
        $("#f-video").textContent = `${it.video} (envoyée)`;
      }
      const rest = state.items.filter((x) => !(x.account === it.account && x.id === it.id));
      await writeSchedule([...rest, it], `${isNew ? "Ajout" : "Modification"} ${it.account}/${it.id} (interface)`);
      root.innerHTML = ""; toast(isNew ? "Publication programmée" : "Modifications enregistrées"); render();
    } catch (e) { toast(e.message, "error"); btn.disabled = false; }
  };
}

// ── interactions ───────────────────────────────────────────────────────────
function bind() {
  $("#prev").onclick = () => { state.cursor = state.view === "month" ? new Date(state.cursor.getFullYear(), state.cursor.getMonth() - 1, 1) : addDays(state.cursor, -7); render(); };
  $("#next").onclick = () => { state.cursor = state.view === "month" ? new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, 1) : addDays(state.cursor, 7); render(); };
  $("#today").onclick = () => { state.cursor = new Date(); render(); };
  $("#views").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; state.view = b.dataset.view; render(); };
  $("#channels").onclick = (e) => { const b = e.target.closest(".channel"); if (!b) return; state.filter = state.filter === b.dataset.key ? null : b.dataset.key; render(); };
  $("#new-post").onclick = () => openEditor(null);
  $("#refresh").onclick = () => loadAll().then(() => toast("Planning rechargé")).catch((e) => toast(e.message, "error"));
  $("#logout").onclick = () => { localStorage.removeItem("pub_token"); location.href = location.pathname; };
  $("#publish-now").onclick = async () => {
    if (!confirm("Lancer maintenant le passage de publication ? Tout ce qui est arrivé à échéance sera publié.")) return;
    try {
      if (!state.demo) await gh(`/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, { method: "POST", body: JSON.stringify({ ref: BRANCH }) });
      toast("Passage lancé : résultat dans 1 à 2 minutes (↻ pour actualiser)");
      setTimeout(() => loadAll().catch(() => {}), 90000);
    } catch (e) { toast(e.message, "error"); }
  };
  $("#content").onclick = (e) => {
    const p = e.target.closest("[data-id]");
    if (p && !e.target.closest("a")) { const it = state.items.find((x) => x.id === p.dataset.id && (x.account || "islam") === p.dataset.account); if (it) return openEditor(it); }
    const add = e.target.closest(".add"); if (add) return openEditor(null, new Date(add.dataset.date));
    const md = e.target.closest(".mday"); if (md) { state.cursor = new Date(md.dataset.date); state.view = "week"; render(); }
  };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#modal-root").innerHTML = ""; });
}

async function start() {
  $("#login-repo").textContent = REPO;
  if (state.demo) { state.token = "demo"; }
  else state.token = localStorage.getItem("pub_token");
  const enter = async () => {
    $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
    await loadAll();
  };
  if (state.token) { try { await enter(); return; } catch (e) { $("#login").classList.remove("hidden"); $("#app").classList.add("hidden"); $("#login-err").textContent = e.message; } }
  $("#login-btn").onclick = async () => {
    const t = $("#token").value.trim(); if (!t) return;
    $("#login-err").textContent = ""; state.token = t;
    try {
      const repo = await gh(`/repos/${REPO}`);
      if (!repo.permissions || !repo.permissions.push) throw new Error("Ce jeton ne peut pas écrire dans le dépôt (permission Contents : Read and write).");
      localStorage.setItem("pub_token", t); $("#token").value = "";
      await enter();
    } catch (e) { state.token = null; $("#login-err").textContent = e.message; }
  };
  $("#token").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#login-btn").click(); });
}

bind();
start();
