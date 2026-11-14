// Cloudflare Worker: REST-API (/api/*) auf Basis von D1. Statische Dateien liefert Cloudflare aus ./public.
import { SCHEMA } from './schema.js';

// Legt die Tabellen beim ersten Zugriff automatisch an (kein manueller Migrationsschritt nötig).
let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = (async () => {
      const t = await db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'settings'").first();
      if (!t) await db.batch(SCHEMA.map((q) => db.prepare(q)));
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}
const T = {
  employees: { cols: ['name', 'info', 'active', 'is_boss', 'deleted', 'sort'], del: false },
  sites: { cols: ['name', 'address', 'customer', 'contact', 'phone', 'description', 'notes', 'work_time', 'start_date', 'status'], del: false },
  entries: { cols: ['date', 'employee_id', 'site_id', 'text', 'color', 'row_type', 'sort'], del: true },
  notes: { cols: ['date', 'text', 'done'], del: true },
  holidays: { cols: ['date', 'name'], del: true },
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

class HttpError extends Error {
  constructor(message, status = 400, data = null) { super(message); this.status = status; this.data = data; }
}
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

async function readBody(request) {
  try { const b = await request.json(); return b && typeof b === 'object' ? b : {}; } catch { throw new HttpError('Ungültige Anfrage (JSON erwartet)'); }
}

function pick(cols, body) {
  const out = {};
  for (const c of cols) {
    if (!(c in body)) continue;
    let v = body[c];
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (v === '' && (c.endsWith('_id') || c === 'color' || c === 'start_date')) v = null;
    if (v === undefined || (v !== null && typeof v === 'object')) throw new HttpError(`Ungültiger Wert für ${c}`);
    if (c === 'date' && !DATE.test(v)) throw new HttpError('Ungültiges Datum');
    out[c] = v;
  }
  return out;
}

async function guard(promise) {
  try { return await promise; } catch (e) {
    const m = String(e && e.message);
    if (/UNIQUE/.test(m)) throw new HttpError('Eintrag existiert bereits', 409);
    if (/CHECK|NOT NULL|FOREIGN/.test(m)) throw new HttpError('Ungültige Daten');
    throw e;
  }
}

const getRow = (db, t, id) => db.prepare(`SELECT * FROM ${t} WHERE id = ?`).bind(id).first();

function datesBetween(from, to) {
  if (!DATE.test(from || '') || !DATE.test(to || '') || from > to) throw new HttpError('Ungültiger Zeitraum');
  const out = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  if (out.length > 366) throw new HttpError('Zeitraum darf höchstens 366 Tage umfassen');
  return out;
}

async function state(db) {
  const names = ['employees', 'sites', 'entries', 'absences', 'notes', 'holidays', 'settings'];
  const res = await db.batch(names.map((n) => db.prepare(`SELECT * FROM ${n}`)));
  const out = {};
  names.forEach((n, i) => (out[n] = res[i].results));
  out.settings = Object.fromEntries(out.settings.map((r) => [r.key, r.value]));
  return out;
}

async function route(request, env, url) {
  const db = env.DB;
  const method = request.method;
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'entries', '12']
  const [, res, id] = parts;

  if (method === 'GET' && res === 'state' && !id) return json(await state(db));
  if (method === 'GET' && res === 'export' && !id) {
    return json(await state(db), 200, { 'Content-Disposition': `attachment; filename="planer-export-${new Date().toISOString().slice(0, 10)}.json"` });
  }
  if (method === 'GET' && res === 'health') { await db.prepare('SELECT 1').first(); return json({ ok: true }); }

  if (res === 'settings' && !id) {
    if (method === 'PUT') {
      const body = await readBody(request);
      const entries = Object.entries(body);
      for (const [k, v] of entries) if (!/^c_[a-z_]+$/.test(k) || !/^#[0-9a-fA-F]{6}$/.test(String(v))) throw new HttpError('Ungültige Einstellung: ' + k);
      if (entries.length) {
        await db.batch(entries.map(([k, v]) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v)));
      }
      return json({ ok: true });
    }
    if (method === 'DELETE') { await db.prepare('DELETE FROM settings').run(); return json({ ok: true }); }
  }

  if (res === 'absences' && method === 'POST') {
    const body = await readBody(request);
    const { employee_id, from, to, type, overwrite } = body;
    if (id === 'range') {
      if (!['vacation', 'sick'].includes(type)) throw new HttpError('Ungültiger Typ');
      if (!(await db.prepare('SELECT 1 AS x FROM employees WHERE id = ?').bind(employee_id).first())) throw new HttpError('Mitarbeiter nicht gefunden', 404);
      const days = datesBetween(from, to);
      const { results: existing } = await db.prepare('SELECT date, type FROM absences WHERE employee_id = ? AND date BETWEEN ? AND ? ORDER BY date').bind(employee_id, from, to).all();
      if (existing.length && !overwrite) throw new HttpError('Bereits eingetragen', 409, { conflicts: existing });
      // Eine einzige Anweisung (atomar, schont das Abfragelimit): Tage per json_each einfügen
      await guard(db.prepare('INSERT INTO absences (employee_id, date, type) SELECT ?1, value, ?2 FROM json_each(?3) WHERE true ON CONFLICT(employee_id, date) DO UPDATE SET type = excluded.type')
        .bind(employee_id, type, JSON.stringify(days)).run());
      return json({ ok: true, days: days.length });
    }
    if (id === 'clear') {
      datesBetween(from, to);
      const r = await db.prepare('DELETE FROM absences WHERE employee_id = ? AND date BETWEEN ? AND ?').bind(employee_id, from, to).run();
      return json({ ok: true, removed: r.meta.changes });
    }
  }

  const def = T[res];
  if (def) {
    if (method === 'POST' && !id) {
      const b = pick(def.cols, await readBody(request));
      const keys = Object.keys(b);
      if (!keys.length) throw new HttpError('Keine Daten übergeben');
      const r = await guard(db.prepare(`INSERT INTO ${res} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...keys.map((k) => b[k])).run());
      return json(await getRow(db, res, r.meta.last_row_id), 201);
    }
    if (method === 'PUT' && id) {
      const b = pick(def.cols, await readBody(request));
      const keys = Object.keys(b);
      if (!keys.length) throw new HttpError('Keine Daten übergeben');
      if (!(await getRow(db, res, id))) throw new HttpError('Nicht gefunden', 404);
      await guard(db.prepare(`UPDATE ${res} SET ${keys.map((k) => `${k} = ?`).join(',')} WHERE id = ?`).bind(...keys.map((k) => b[k]), id).run());
      return json(await getRow(db, res, id));
    }
    if (method === 'DELETE' && id && def.del) {
      await db.prepare(`DELETE FROM ${res} WHERE id = ?`).bind(id).run();
      return json({ ok: true });
    }
  }
  throw new HttpError('Unbekannte Schnittstelle', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (!env.DB) throw new HttpError('Datenbank-Verbindung (D1-Binding "DB") fehlt', 500);
      await ensureSchema(env.DB);
      return await route(request, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.data || {}) }, e.status);
      console.error(e);
      return json({ error: 'Interner Serverfehler' }, 500);
    }
  },
};
