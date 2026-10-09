// Shared helpers for the audit's black-box tests. LOCAL ONLY: every URL is
// checked to be loopback before anything is sent (audit rule 4).
//
//   const { app, login, callAction, actions, sql } = await import("./lib.mjs");
//
// Nothing here prints keys. Keys are read from the throw-away local key file
// that local-stack.sh creates.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

export const APP = process.env.AUDIT_APP ?? "http://127.0.0.1:3100";
export const AUTH = process.env.AUDIT_AUTH ?? "http://127.0.0.1:54321";
for (const u of [APP, AUTH]) {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(u)) throw new Error(`REFUSING non-local URL ${u}`);
}

const keys = Object.fromEntries(
  readFileSync(process.env.AUDIT_KEYS_FILE ?? "/tmp/claude-0/audit-keys.env", "utf8")
    .split("\n").filter(Boolean).map((l) => l.split("=")),
);
export const ANON = keys.AUDIT_ANON;
export const SVC = keys.AUDIT_SVC;
export const PASSWORD = "Audit-Local-Pass-1";

/** Run SQL on the LOCAL audit database (superuser). Returns rows as arrays of strings. */
export function sql(query, db = "lcc_tr") {
  const out = execFileSync("psql", ["-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-d", db, "-At", "-F", "\t", "-c", query], { encoding: "utf8" });
  return out.split("\n").filter(Boolean).map((l) => l.split("\t"));
}

/** Server-action ids from the build's own manifest: name -> { id, file, pages }. */
export const actions = (() => {
  const m = JSON.parse(readFileSync(resolve(root, ".next/server/server-reference-manifest.json"), "utf8")).node;
  const out = {};
  for (const [id, v] of Object.entries(m)) {
    const pages = Object.keys(v.workers).map((w) => w.replace(/^app/, "").replace(/\/\([^)]*\)/g, "").replace(/\/page$/, "") || "/");
    out[v.exportedName] = { id, file: v.filename, pages };
  }
  return out;
})();

/** A tiny cookie jar: name -> value. */
export class Jar {
  constructor() { this.c = new Map(); }
  absorb(res) {
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = sc.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0/i.test(a)) || value === "";
      if (expired) this.c.delete(name); else this.c.set(name, value);
    }
  }
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); }
  flags(name) { return this._raw?.get(name); }
}

/** Plain request, no redirect following. */
export async function req(path, { method = "GET", jar, headers = {}, body } = {}) {
  const res = await fetch(APP + path, { method, redirect: "manual", headers: { ...(jar ? { cookie: jar.header() } : {}), ...headers }, body });
  jar?.absorb(res);
  return res;
}

/**
 * Call a server action the way a browser form without JavaScript does: a
 * multipart POST to a page that registers the action, carrying the hidden
 * `$ACTION_ID_<id>` field plus the form fields. Returns the response, with
 * `.location` (redirect target) and `.text` already read.
 */
export async function callAction(name, fields = {}, { jar, page } = {}) {
  const a = actions[name];
  if (!a) throw new Error(`unknown action ${name}`);
  const fd = new FormData();
  fd.append(`$ACTION_ID_${a.id}`, "");
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const path = page ?? a.pages[0];
  const res = await fetch(APP + path, { method: "POST", redirect: "manual", headers: jar ? { cookie: jar.header() } : {}, body: fd });
  jar?.absorb(res);
  const text = await res.text();
  return { status: res.status, location: res.headers.get("location"), text, headers: res.headers, path };
}

/** Sign in through the app's real login action; returns a Jar holding the session cookies. */
export async function login(identifier, password = PASSWORD) {
  const jar = new Jar();
  const r = await callAction("loginAction", { identifier, password }, { jar });
  return { jar, location: r.location, status: r.status, raw: r };
}

/** Create (or reset) a LOCAL auth user + app_user row for the audit. */
export async function ensureAccount({ identifier, role, displayName, mustChange = false, status = "ACTIVE", password = PASSWORD }) {
  const email = /^(19|20)\d{4,8}$/.test(identifier) ? `${identifier}@students.lcc-eportal.invalid` : `${identifier}@staff.lcc-eportal.invalid`;
  const h = { Authorization: `Bearer ${SVC}`, apikey: SVC, "Content-Type": "application/json" };
  let id = sql(`select id from app.app_user where login_identifier='${identifier}'`)[0]?.[0];
  if (id) {
    await fetch(`${AUTH}/auth/v1/admin/users/${id}`, { method: "PUT", headers: h, body: JSON.stringify({ password, email_confirm: true }) });
  } else {
    const r = await fetch(`${AUTH}/auth/v1/admin/users`, { method: "POST", headers: h, body: JSON.stringify({ email, password, email_confirm: true }) });
    const j = await r.json();
    if (!r.ok) throw new Error(`auth create ${identifier}: ${JSON.stringify(j)}`);
    id = j.id;
    sql(`insert into app.app_user (id, login_identifier, display_name, role, status, must_change_password) values ('${id}','${identifier}','${displayName}','${role}','${status}',${mustChange})`);
  }
  sql(`update app.app_user set status='${status}', must_change_password=${mustChange} where id='${id}'`);
  return id;
}

export const results = [];
export function record(id, title, verdict, detail) {
  results.push({ id, title, verdict, detail });
  const tag = { PASS: "PASS ", FAIL: "FAIL ", INFO: "INFO " }[verdict] ?? verdict;
  console.log(`${tag} ${id}  ${title}${detail ? "\n        " + detail : ""}`);
}

/** Run a TypeScript helper from the app's own code (service layer) against the LOCAL stack. */
export function runTs(file, args = []) {
  return execFileSync("npx", ["tsx", resolve(here, file), ...args], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "postgresql://postgres@127.0.0.1:54329/lcc_tr", NEXT_PUBLIC_SUPABASE_URL: AUTH, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SVC, NODE_OPTIONS: "--conditions=react-server" },
  });
}

/** Call an action the way the browser's client JS does for actions with plain arguments (Next-Action header + JSON body). */
export async function callRpc(name, args, { jar, page } = {}) {
  const a = actions[name];
  if (!a) throw new Error(`unknown action ${name}`);
  const path = page ?? a.pages[0];
  const res = await fetch(APP + path, {
    method: "POST", redirect: "manual",
    headers: { ...(jar ? { cookie: jar.header() } : {}), "Next-Action": a.id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
    body: JSON.stringify(args),
  });
  jar?.absorb(res);
  const text = await res.text();
  return { status: res.status, location: res.headers.get("x-action-redirect") ?? res.headers.get("location"), text, headers: res.headers, path };
}

/** POST arbitrary form fields (used to replay the hidden fields of a useActionState form). */
export async function postForm(path, fields, { jar } = {}) {
  const fd = new FormData();
  for (const [k, v] of fields) fd.append(k, v);
  const res = await fetch(APP + path, { method: "POST", redirect: "manual", headers: jar ? { cookie: jar.header() } : {}, body: fd });
  jar?.absorb(res);
  const text = await res.text();
  return { status: res.status, location: res.headers.get("location"), text, headers: res.headers, path };
}
