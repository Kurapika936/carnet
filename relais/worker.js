// Relais de l'app « Word Up » : traduction (Claude, DeepL en secours) + synchronisation des mots.
// À coller dans le Worker Cloudflare « carnet-deepl » (Edit code → tout remplacer → Deploy).
//
// Variables (Settings → Variables and Secrets) :
//   ANTHROPIC_KEY   (Secret) ta clé API Claude (console Anthropic) — traduction + exemple + note
//   DEEPL_KEY       (Secret) ta clé API DeepL — utilisée en secours, ou si tu choisis DeepL
//   APP_PASSWORD    (Secret) ton mot de passe, le même que dans l'app
//   ALLOWED_ORIGIN  (Text, facultatif) https://kurapika936.github.io
//   CLAUDE_MODEL    (Text, facultatif) par défaut claude-haiku-4-5-20251001
// Liaison (Bindings) :
//   WORDS           (KV namespace) la base où sont rangés tes mots

const MAX_CHARS = 1000;
const KEY = "carnet";
const FKEY = "dossiers";
const MAX_ENTRIES = 20000;
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

// ---------- Synchronisation : « le plus récent gagne », mot par mot ----------
function merge(a, b) {
  const byId = new Map();
  for (const e of [...a, ...b]) {
    if (!e || typeof e.id !== "string") continue;
    const cur = byId.get(e.id);
    if (!cur || (Number(e.updatedAt) || 0) > (Number(cur.updatedAt) || 0)) byId.set(e.id, e);
  }
  return [...byId.values()];
}
function clean(e) {
  const s = (v, n) => String(v ?? "").slice(0, n);
  const id = s(e?.id, 64), updatedAt = Number(e?.updatedAt) || 0;
  if (!id) return null;
  if (e.deleted) return { id, deleted: true, updatedAt };
  return {
    id, en: s(e.en, 2000), fr: s(e.fr, 2000), note: s(e.note, 2000),
    exEn: s(e.exEn, 1000), exFr: s(e.exFr, 1000), tip: s(e.tip, 1000), folder: s(e.folder, 64),
    origin: e.origin === "fr" ? "fr" : "en", status: e.status === "learned" ? "learned" : "new",
    createdAt: Number(e.createdAt) || updatedAt, updatedAt,
  };
}

function cleanFolder(f) {
  const s = (v, n) => String(v ?? "").slice(0, n);
  const id = s(f?.id, 64), updatedAt = Number(f?.updatedAt) || 0;
  if (!id) return null;
  if (f.deleted) return { id, deleted: true, updatedAt };
  return { id, name: s(f.name, 60), emoji: s(f.emoji, 16), updatedAt };
}
async function mergeKey(env, key, incoming) {
  let stored = [];
  try { stored = JSON.parse((await env.WORDS.get(key)) || "[]"); } catch { stored = []; }
  const merged = merge(stored, incoming);
  const sig = l => JSON.stringify(l.map(e => [e.id, e.updatedAt]).sort());
  if (sig(stored) !== sig(merged)) await env.WORDS.put(key, JSON.stringify(merged));
  return merged;
}

// ---------- Traduction avec Claude ----------
function claudePrompt(source, target, folders) {
  const variant = target === "EN-GB" ? "British English (British spelling and usage)"
                : target === "EN-US" ? "American English (American spelling and usage)" : "French";
  const from = source === "FR" ? "French" : "English";
  return `You are a translation assistant for a French speaker who is learning English.
Translate the user's text from ${from} into ${variant}.
Rules:
- Translate faithfully and completely. Keep the meaning, tone and register. Do not add or drop information.
- Prefer the phrasing a native speaker would naturally use (idioms over word-for-word).
- If a "Context" is given, use it only to pick the right meaning. Never translate or include the context itself.
- Reply with ONLY a JSON object, no other text, in exactly this shape:
{"translation": "...", "alternatives": ["..."], "example_en": "...", "example_fr": "...", "note": "..."}
- "alternatives": 0 to 2 other natural translations, only if they are genuinely different and correct; otherwise [].
- "example_en": one short, natural, everyday English sentence that uses the English expression (the translation if translating into English, otherwise the user's English text).
- "example_fr": the French translation of example_en.
- "note": one short sentence in French on usage, register or a common pitfall (e.g. familier, formel, faux ami). Use "" if there is nothing useful to say.` +
  (folders.length ? `
- Also add "folder": the name of the ONE folder below that clearly fits this text's topic, copied exactly, or "" if none clearly fits. Folders: ${JSON.stringify(folders)}` : "");
}
function parseJsonObject(t) {
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i < 0 || j <= i) throw new Error("bad json");
  return JSON.parse(t.slice(i, j + 1));
}
async function translateClaude(env, { text, source, target, context, folders }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_KEY.trim(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: (env.CLAUDE_MODEL || DEFAULT_MODEL).trim(),
      max_tokens: 500,
      system: claudePrompt(source, target, folders),
      messages: [{ role: "user", content: (context ? `Context: ${context}\n\n` : "") + `Text to translate:\n${text}` }],
    }),
  });
  if (!res.ok) {
    let msg = ""; try { msg = (await res.json())?.error?.message || ""; } catch {}
    const why = res.status === 401 ? "clé Claude refusée"
              : /credit balance/i.test(msg) ? "crédit Claude épuisé"
              : res.status === 429 ? "trop de demandes d'affilée"
              : res.status === 529 || res.status >= 500 ? "Claude est surchargé" : `erreur Claude ${res.status}`;
    throw new Error(why);
  }
  const data = await res.json();
  const raw = (data?.content || []).map(c => c.text || "").join("");
  const j = parseJsonObject(raw);
  const str = (v, n) => String(v ?? "").trim().slice(0, n);
  const translation = str(j.translation, 2000);
  if (!translation) throw new Error("réponse Claude vide");
  return {
    translation,
    alternatives: (Array.isArray(j.alternatives) ? j.alternatives : []).map(a => str(a, 500)).filter(a => a && a !== translation).slice(0, 2),
    exampleEn: str(j.example_en, 500), exampleFr: str(j.example_fr, 500), note: str(j.note, 300),
    folder: folders.includes(str(j.folder, 60)) ? str(j.folder, 60) : "",
    engine: "claude",
  };
}

// ---------- Tri automatique des mots dans des dossiers (Claude) ----------
async function sortWithClaude(env, words, folders, hint) {
  const system = `You organise the vocabulary notebook of a French speaker who is learning English into topic folders.
Existing folders (name and emoji): ${JSON.stringify(folders)}
The user's wishes: ${hint ? JSON.stringify(hint) : "(none)"}
Rules:
- Put EVERY word into exactly one folder.
- Prefer existing folders. Create a new folder only if the user asked for it, or if at least 3 words clearly share a topic that no existing folder covers. At most 6 new folders.
- New folder names: short, in French, capitalised (e.g. "Conjugaison", "Cuisine"), each with one fitting emoji.
- Grammar items (verb tenses, conjugated or irregular verb forms, auxiliaries) belong in a grammar folder such as "Conjugaison" when one exists or is requested.
- Use a catch-all folder like "Divers" only for words that fit nowhere else.
- Reply with ONLY a JSON object, no other text:
{"new_folders":[{"name":"...","emoji":"..."}],"assign":[[0,"Folder name"],[1,"Folder name"]]}
where each number is the word's index in the list below and each folder name is copied exactly from the existing or new folders.`;
  const list = words.map((w, i) => `${i}. ${w.en} = ${w.fr}${w.note ? " (" + w.note + ")" : ""}`).join("\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_KEY.trim(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: (env.CLAUDE_MODEL || DEFAULT_MODEL).trim(), max_tokens: 8000, system, messages: [{ role: "user", content: "Words:\n" + list }] }),
  });
  if (!res.ok) {
    let msg = ""; try { msg = (await res.json())?.error?.message || ""; } catch {}
    throw new Error(res.status === 401 ? "clé Claude refusée" : /credit balance/i.test(msg) ? "crédit Claude épuisé"
      : res.status === 429 ? "trop de demandes d'affilée" : res.status >= 500 ? "Claude est surchargé" : `erreur Claude ${res.status}`);
  }
  const data = await res.json();
  const j = parseJsonObject((data?.content || []).map(c => c.text || "").join(""));
  const str = (v, n) => String(v ?? "").trim().slice(0, n);
  const newFolders = (Array.isArray(j.new_folders) ? j.new_folders : []).slice(0, 6)
    .map(f => ({ name: str(f?.name, 40), emoji: str(f?.emoji, 8) })).filter(f => f.name);
  const valid = new Set([...folders.map(f => f.name), ...newFolders.map(f => f.name)]);
  const assign = (Array.isArray(j.assign) ? j.assign : [])
    .filter(a => Array.isArray(a) && Number.isInteger(a[0]) && a[0] >= 0 && a[0] < words.length && valid.has(str(a[1], 40)))
    .map(a => [a[0], str(a[1], 40)]);
  return { newFolders, assign };
}

// ---------- Traduction avec DeepL ----------
async function translateDeepL(env, { text, source, target, context }) {
  const host = env.DEEPL_KEY.trim().endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
  const payload = { text: [text], source_lang: source, target_lang: target };
  if (context) payload.context = context;
  let res;
  try {
    res = await fetch(host + "/v2/translate", {
      method: "POST",
      headers: { "Authorization": "DeepL-Auth-Key " + env.DEEPL_KEY.trim(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch { throw Object.assign(new Error("DeepL ne répond pas."), { status: 502 }); }
  if (res.ok) {
    const data = await res.json();
    return { translation: data?.translations?.[0]?.text || "", engine: "deepl" };
  }
  const messages = { 403: "Clé DeepL refusée : vérifie DEEPL_KEY.", 429: "Trop de demandes d'affilée : attends quelques secondes.", 456: "Ton crédit de caractères DeepL est épuisé." };
  throw Object.assign(new Error(messages[res.status] || `DeepL a renvoyé une erreur (${res.status}).`), { status: res.status === 456 ? 402 : 502 });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    let allowed = "*";
    if (env.ALLOWED_ORIGIN) { try { allowed = new URL(env.ALLOWED_ORIGIN.trim()).origin; } catch { allowed = "*"; } }
    const cors = {
      "Access-Control-Allow-Origin": allowed === "*" ? "*" : allowed,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-App-Password",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    const reply = (status, body) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return reply(405, { error: "method", message: "Utilise POST." });
    if (allowed !== "*" && origin && origin !== allowed) {
      return reply(403, { error: "origin", message: "Cette adresse n'est pas autorisée." });
    }
    if (!env.APP_PASSWORD || request.headers.get("X-App-Password") !== env.APP_PASSWORD) {
      return reply(401, { error: "password", message: "Mot de passe incorrect." });
    }

    let body;
    try { body = await request.json(); } catch { return reply(400, { error: "body", message: "Requête illisible." }); }

    // Test de connexion : dit ce qui est configuré, sans rien consommer.
    if (body && body.ping) return reply(200, { ok: true, sync: !!env.WORDS, claude: !!env.ANTHROPIC_KEY, deepl: !!env.DEEPL_KEY });

    // ---------- Synchronisation ----------
    if (body && body.sync) {
      if (!env.WORDS) return reply(501, { error: "no_kv", message: "Synchronisation pas encore activée : ajoute la liaison WORDS dans Cloudflare." });
      const incoming = Array.isArray(body.entries) ? body.entries.slice(0, MAX_ENTRIES).map(clean).filter(Boolean) : [];
      const incomingF = Array.isArray(body.folders) ? body.folders.slice(0, 500).map(cleanFolder).filter(Boolean) : [];
      const entries = await mergeKey(env, KEY, incoming);
      const folders = await mergeKey(env, FKEY, incomingF);
      return reply(200, { entries, folders, serverTime: Date.now() });
    }

    // ---------- Tri automatique ----------
    if (body && body.sortWords) {
      if (!env.ANTHROPIC_KEY) return reply(500, { error: "config", message: "Le tri automatique a besoin de la clé Claude (ANTHROPIC_KEY)." });
      const words = (Array.isArray(body.words) ? body.words : []).slice(0, 400)
        .map(w => ({ en: String(w?.en || "").slice(0, 200), fr: String(w?.fr || "").slice(0, 200), note: String(w?.note || "").slice(0, 100) }));
      const folders = (Array.isArray(body.folders) ? body.folders : []).slice(0, 50)
        .map(f => ({ name: String(f?.name || "").slice(0, 40), emoji: String(f?.emoji || "").slice(0, 8) })).filter(f => f.name);
      if (!words.length) return reply(400, { error: "empty", message: "Aucun mot à trier." });
      try { return reply(200, await sortWithClaude(env, words, folders, String(body.hint || "").slice(0, 300))); }
      catch (e) { return reply(502, { error: "claude", message: "Tri impossible : " + (e.message || "Claude indisponible") + "." }); }
    }

    // ---------- Traduction ----------
    const req = {
      text: String(body?.text || "").trim(),
      source: String(body?.source || "").toUpperCase(),
      target: String(body?.target || "").toUpperCase(),
      context: String(body?.context || "").slice(0, 500),
      folders: (Array.isArray(body?.folders) ? body.folders : []).map(f => String(f).slice(0, 60)).filter(Boolean).slice(0, 50),
    };
    if (!req.text) return reply(400, { error: "empty", message: "Rien à traduire." });
    if (req.text.length > MAX_CHARS) return reply(400, { error: "long", message: `Texte trop long (max ${MAX_CHARS} caractères).` });
    if (!["FR", "EN"].includes(req.source) || !["FR", "EN-GB", "EN-US"].includes(req.target)) {
      return reply(400, { error: "lang", message: "Langues non prises en charge." });
    }

    const wantClaude = body.engine !== "deepl" && !!env.ANTHROPIC_KEY;
    if (!wantClaude && !env.DEEPL_KEY) {
      return reply(500, { error: "config", message: "Aucune clé de traduction : ajoute ANTHROPIC_KEY ou DEEPL_KEY dans Cloudflare." });
    }
    let claudeError = "";
    if (wantClaude) {
      try { return reply(200, await translateClaude(env, req)); }
      catch (e) { claudeError = e.message || "Claude indisponible"; }
      if (!env.DEEPL_KEY) return reply(502, { error: "claude", message: "Traduction impossible : " + claudeError + "." });
    }
    try {
      const r = await translateDeepL(env, req);
      if (claudeError) { r.fallback = true; r.reason = claudeError; }
      return reply(200, r);
    } catch (e) {
      return reply(e.status || 502, { error: "deepl", message: (claudeError ? "Claude : " + claudeError + ". " : "") + e.message });
    }
  },
};
