import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { AUTH_DIR, DATA_DIR, DB_PATH, MEDIA_DIR, normalizeName, now, uid } from "./utils.js";

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(AUTH_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS clusters (
  id TEXT PRIMARY KEY,
  chat_jid TEXT,
  status TEXT NOT NULL DEFAULT 'collecting',
  extracted_json TEXT,
  confidence REAL,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  analyzed_at INTEGER
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  wa_id TEXT UNIQUE,
  chat_jid TEXT,
  sender_jid TEXT,
  sender_name TEXT,
  timestamp INTEGER,
  type TEXT,
  text TEXT,
  transcription TEXT,
  media_path TEXT,
  mime_type TEXT,
  quoted_wa_id TEXT,
  cluster_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (cluster_id) REFERENCES clusters(id)
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_norm TEXT,
  phone TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  cluster_id TEXT,
  customer_id TEXT,
  customer_name TEXT,
  width REAL,
  height REAL,
  quantity INTEGER DEFAULT 1,
  color_type TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (cluster_id) REFERENCES clusters(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  number INTEGER UNIQUE,
  customer_id TEXT NOT NULL,
  job_id TEXT,
  unit_price REAL DEFAULT 0,
  quantity INTEGER DEFAULT 1,
  total REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  invoice_id TEXT,
  amount REAL NOT NULL,
  method TEXT NOT NULL,
  account TEXT NOT NULL,
  notes TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  related_payment_id TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (related_payment_id) REFERENCES payments(id)
);

CREATE TABLE IF NOT EXISTS learning_examples (
  id TEXT PRIMARY KEY,
  input_text TEXT,
  extracted_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dictionary (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_cluster ON messages(cluster_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_jid, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_wa ON messages(wa_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_customers_norm ON customers(name_norm);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
`);

const defaults = {
  workshop_name: "ورشة ضلف السلك البلسي",
  gemini_model: "gemini-3.6-flash",
  cluster_window_ms: String(8 * 60 * 1000),
  analyze_delay_ms: String(8 * 1000),
  selected_group_jid: "",
  selected_group_name: "",
  gemini_api_key: "",
};

const insertSetting = db.prepare(
  "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
);
for (const [key, value] of Object.entries(defaults)) {
  insertSetting.run(key, value);
}

try {
  db.exec("ALTER TABLE jobs ADD COLUMN sizes_json TEXT");
} catch {
  // already exists
}
try {
  db.exec("ALTER TABLE messages ADD COLUMN from_me INTEGER DEFAULT 0");
} catch {
  // already exists
}
try {
  db.exec("ALTER TABLE messages ADD COLUMN reacted INTEGER DEFAULT 0");
} catch {
  // already exists
}
try {
  db.exec("ALTER TABLE messages ADD COLUMN intent_json TEXT");
} catch {
  // already exists
}
try {
  db.exec("ALTER TABLE clusters ADD COLUMN kind TEXT");
} catch {
  // already exists
}
try {
  db.exec("ALTER TABLE clusters ADD COLUMN auto_applied INTEGER DEFAULT 0");
} catch {
  // already exists
}

db.exec(`
CREATE TABLE IF NOT EXISTS price_list (
  id TEXT PRIMARY KEY,
  item_key TEXT NOT NULL,
  unit_price REAL NOT NULL,
  notes TEXT,
  updated_at INTEGER NOT NULL
);
`);

if (["gemini-2.0-flash", "gemini-1.5-flash", ""].includes(getSetting("gemini_model", ""))) {
  setSetting("gemini_model", "gemini-3.6-flash");
}
if (Number(getSetting("analyze_delay_ms", "90000")) >= 30000) {
  setSetting("analyze_delay_ms", "8000");
}

const colorSeeds = ["أبيض", "أخضر", "بني", "بيج", "أسود", "رمادي"];
const seedDict = db.prepare(
  "INSERT OR IGNORE INTO dictionary (id, kind, key, value, created_at) VALUES (?, ?, ?, ?, ?)"
);
for (const color of colorSeeds) {
  const exists = db.prepare("SELECT id FROM dictionary WHERE kind = 'color' AND key = ?").get(color);
  if (!exists) seedDict.run(uid(), "color", color, color, now());
}

export function getSetting(key, fallback = "") {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row?.value ?? fallback;
}

export function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value == null ? "" : String(value));
}

export function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const out = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export function findOrCreateCustomer(name, extra = {}) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  const nameNorm = normalizeName(trimmed);
  const existing = db
    .prepare("SELECT * FROM customers WHERE name_norm = ?")
    .get(nameNorm);
  if (existing) {
    if (extra.phone && !existing.phone) {
      db.prepare("UPDATE customers SET phone = ? WHERE id = ?").run(extra.phone, existing.id);
    }
    return db.prepare("SELECT * FROM customers WHERE id = ?").get(existing.id);
  }
  const id = uid();
  db.prepare(
    "INSERT INTO customers (id, name, name_norm, phone, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, trimmed, nameNorm, extra.phone || "", extra.notes || "", now());
  return db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
}

export function customerBalance(customerId) {
  const invoiced = db
    .prepare("SELECT COALESCE(SUM(total), 0) AS n FROM invoices WHERE customer_id = ?")
    .get(customerId).n;
  const paid = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE customer_id = ?")
    .get(customerId).n;
  return {
    invoiced,
    paid,
    balance: invoiced - paid,
  };
}

export function nextInvoiceNumber() {
  const row = db.prepare("SELECT COALESCE(MAX(number), 0) AS n FROM invoices").get();
  return row.n + 1;
}

export function upsertDictionary(kind, key, value = key) {
  const k = String(key || "").trim();
  if (!k) return;
  const existing = db
    .prepare("SELECT id FROM dictionary WHERE kind = ? AND key = ?")
    .get(kind, k);
  if (existing) {
    db.prepare("UPDATE dictionary SET value = ? WHERE id = ?").run(value, existing.id);
    return;
  }
  db.prepare(
    "INSERT INTO dictionary (id, kind, key, value, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(uid(), kind, k, value, now());
}

export function listDictionary() {
  return db.prepare("SELECT * FROM dictionary ORDER BY kind, key").all();
}

export function upsertPrice(itemKey, unitPrice, notes = "") {
  const key = String(itemKey || "").trim();
  const price = Number(unitPrice || 0);
  if (!key || price <= 0) throw new Error("الصنف والسعر مطلوبين");
  const existing = db.prepare("SELECT * FROM price_list WHERE item_key = ?").get(key);
  const ts = now();
  if (existing) {
    db.prepare("UPDATE price_list SET unit_price = ?, notes = ?, updated_at = ? WHERE id = ?").run(
      price,
      notes || existing.notes || "",
      ts,
      existing.id
    );
    return db.prepare("SELECT * FROM price_list WHERE id = ?").get(existing.id);
  }
  const id = uid();
  db.prepare("INSERT INTO price_list (id, item_key, unit_price, notes, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    id,
    key,
    price,
    notes,
    ts
  );
  return db.prepare("SELECT * FROM price_list WHERE id = ?").get(id);
}

export function listPrices() {
  return db.prepare("SELECT * FROM price_list ORDER BY item_key").all();
}
