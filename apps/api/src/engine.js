import { db, findOrCreateCustomer, getSetting, nextInvoiceNumber, upsertDictionary, upsertPrice } from "./db.js";
import { analyzeImage, classifyMessage, extractGroup, mergeIntents, shouldLink, transcribeAudio } from "./ai.js";
import { createPayment, updateCustomer } from "./accounting.js";
import { normalizeName, now, parseJson, uid } from "./utils.js";

const analyzeTimers = new Map();
const analyzeLocks = new Set();
const AUTO_APPLY_CONFIDENCE = 0.85;

function clusterIntent(cluster) {
  const intents = (cluster.messages || []).map((m) => m.intent || parseJson(m.intent_json, null)).filter(Boolean);
  return mergeIntents(intents, cluster.messages || []);
}

export function assignCluster(msg) {
  if (msg.quoted_wa_id) {
    const quoted = db.prepare("SELECT cluster_id FROM messages WHERE wa_id = ?").get(msg.quoted_wa_id);
    if (quoted?.cluster_id) {
      const parent = db.prepare("SELECT status FROM clusters WHERE id = ?").get(quoted.cluster_id);
      if (parent && !["confirmed", "dismissed"].includes(parent.status)) return quoted.cluster_id;
    }
  }

  const id = uid();
  const ts = now();
  db.prepare(
    "INSERT INTO clusters (id, chat_jid, status, created_at, updated_at) VALUES (?, ?, 'collecting', ?, ?)"
  ).run(id, msg.chat_jid, ts, ts);
  return id;
}

export function scheduleAnalyze(clusterId, emit) {
  const delay = Number(getSetting("analyze_delay_ms", String(20 * 1000)));
  const prev = analyzeTimers.get(clusterId);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    analyzeTimers.delete(clusterId);
    analyzeCluster(clusterId, emit).catch((err) => {
      console.error("analyze failed", err);
    });
  }, delay);
  analyzeTimers.set(clusterId, timer);
}

function cancelAnalyze(clusterId) {
  const prev = analyzeTimers.get(clusterId);
  if (prev) clearTimeout(prev);
  analyzeTimers.delete(clusterId);
}

function findCustomerByName(name) {
  const n = normalizeName(name);
  if (!n) return null;
  return db.prepare("SELECT * FROM customers WHERE name_norm = ?").get(n);
}

function relinkOpenClusters(clusterId) {
  const me = getCluster(clusterId);
  if (!me || ["confirmed", "dismissed"].includes(me.status)) return { id: clusterId, merged: false };
  const myIntent = clusterIntent(me);
  const windowMs = Number(getSetting("cluster_window_ms", String(8 * 60 * 1000)));
  const myTs = Math.max(...me.messages.map((m) => Number(m.timestamp || 0)), me.created_at || 0);

  const candidates = db
    .prepare(
      `SELECT DISTINCT c.id
       FROM clusters c
       JOIN messages m ON m.cluster_id = c.id
       WHERE c.id != ? AND c.chat_jid = ? AND c.status IN ('collecting', 'analyzing', 'needs_review')
         AND m.timestamp > ?
       ORDER BY c.updated_at DESC`
    )
    .all(clusterId, me.chat_jid, myTs - windowMs);

  for (const row of candidates) {
    if (analyzeLocks.has(row.id)) continue;
    const other = getCluster(row.id);
    if (!other?.messages?.length) continue;
    const otherIntent = clusterIntent(other);
    const sameSender = me.messages.some((a) => other.messages.some((b) => a.sender_jid && a.sender_jid === b.sender_jid));
    if (!shouldLink(myIntent, otherIntent, { sameSender, windowMs })) continue;

    const targetId = other.created_at <= me.created_at ? other.id : me.id;
    const sourceId = targetId === other.id ? me.id : other.id;
    cancelAnalyze(sourceId);
    mergeClusters(targetId, sourceId);
    return { id: targetId, merged: true };
  }
  return { id: clusterId, merged: false };
}

async function prepareMedia(messages) {
  for (const msg of messages) {
    if (msg.type === "audio" && msg.media_path && !msg.transcription) {
      const text = await transcribeAudio(msg.media_path, msg.mime_type);
      if (text) {
        db.prepare("UPDATE messages SET transcription = ? WHERE id = ?").run(text, msg.id);
        msg.transcription = text;
      }
    }
    if (msg.type === "image" && msg.media_path && !msg.transcription) {
      const text = await analyzeImage(msg.media_path, msg.mime_type);
      if (text) {
        db.prepare("UPDATE messages SET transcription = ? WHERE id = ?").run(text, msg.id);
        msg.transcription = text;
      }
    }
  }
}

async function classifyMessages(messages, force = false) {
  for (const msg of messages) {
    const current = parseJson(msg.intent_json, null);
    if (!force && current?.kind && current.source !== "pending") continue;
    const intent = await classifyMessage(msg);
    db.prepare("UPDATE messages SET intent_json = ? WHERE id = ?").run(JSON.stringify(intent), msg.id);
    msg.intent_json = JSON.stringify(intent);
    msg.intent = intent;
  }
}

function autoApplyDecision(extracted) {
  const kind = extracted?.kind;
  const conf = Number(extracted?.confidence || 0);
  if (kind === "ignore" && conf >= 0.7) return "dismiss";
  if (conf < AUTO_APPLY_CONFIDENCE) return "";
  if (kind === "payment") {
    if (!extracted.amount || !extracted.customer_name) return "";
    const known = findCustomerByName(extracted.customer_name);
    if (known || conf >= 0.9) return "payment";
    return "";
  }
  if (kind === "customer_contact") {
    if (!extracted.phone || !extracted.customer_name) return "";
    return "contact";
  }
  if (kind === "price_update") {
    if (!extracted.unit_price || !extracted.color_type) return "";
    return "price";
  }
  return "";
}

async function likeSourceMessages(messages) {
  try {
    const { reactLikeToMessages } = await import("./whatsapp.js");
    await reactLikeToMessages(messages || []);
  } catch (err) {
    console.error("auto like failed", err);
  }
}

function rememberExample(cluster, extracted) {
  const inputText = (cluster.messages || [])
    .map((m) => [m.text, m.transcription].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n");
  if (!inputText) return;
  db.prepare("INSERT INTO learning_examples (id, input_text, extracted_json, created_at) VALUES (?, ?, ?, ?)").run(
    uid(),
    inputText,
    JSON.stringify(extracted),
    now()
  );
}

function applyAutoResult(clusterId, extracted, extra = {}) {
  const ts = now();
  const payload = { ...extracted, auto_applied: true, ...extra };
  db.prepare(
    "UPDATE clusters SET status = ?, kind = ?, extracted_json = ?, confidence = ?, auto_applied = 1, updated_at = ?, analyzed_at = ? WHERE id = ?"
  ).run("confirmed", extracted.kind || "", JSON.stringify(payload), extracted.confidence ?? 0, ts, ts, clusterId);
}

async function autoApplyCluster(cluster, extracted, emit) {
  const action = autoApplyDecision(extracted);
  if (!action) return null;

  if (action === "dismiss") {
    db.prepare(
      "UPDATE clusters SET status = 'dismissed', kind = 'ignore', extracted_json = ?, confidence = ?, auto_applied = 1, updated_at = ?, analyzed_at = ? WHERE id = ?"
    ).run(JSON.stringify({ ...extracted, auto_applied: true }), extracted.confidence ?? 0, now(), now(), cluster.id);
    rememberExample(cluster, extracted);
    const updated = getCluster(cluster.id);
    emit?.("cluster_updated", updated);
    return updated;
  }

  try {
    if (action === "payment") {
      const customer = findOrCreateCustomer(extracted.customer_name);
      const payment = createPayment({
        customer_id: customer.id,
        amount: extracted.amount,
        method: extracted.method || "cash",
        notes: extracted.notes || "دفعة من الواتساب",
      });
      applyAutoResult(cluster.id, extracted, { customer_id: customer.id, payment_id: payment.id });
    } else if (action === "contact") {
      const customer = findOrCreateCustomer(extracted.customer_name, { phone: extracted.phone });
      if (extracted.phone) updateCustomer(customer.id, { phone: extracted.phone });
      applyAutoResult(cluster.id, extracted, { customer_id: customer.id });
    } else if (action === "price") {
      const price = upsertPrice(extracted.color_type, extracted.unit_price, extracted.notes || "");
      if (extracted.color_type) upsertDictionary("color", extracted.color_type, extracted.color_type);
      applyAutoResult(cluster.id, extracted, { price_id: price.id });
    }
    rememberExample(cluster, { ...extracted, auto_applied: true });
    const updated = getCluster(cluster.id);
    await likeSourceMessages(updated.messages);
    emit?.("cluster_updated", updated);
    return updated;
  } catch (err) {
    console.error("auto-apply failed", err);
    return null;
  }
}

export async function analyzeCluster(clusterId, emit, opts = {}) {
  const depth = opts.depth || 0;
  const force = Boolean(opts.force);
  const cluster = db.prepare("SELECT * FROM clusters WHERE id = ?").get(clusterId);
  if (!cluster || cluster.status === "confirmed" || cluster.status === "dismissed") return cluster;
  if (analyzeLocks.has(clusterId)) return getCluster(clusterId);

  analyzeLocks.add(clusterId);
  db.prepare("UPDATE clusters SET status = 'analyzing', updated_at = ? WHERE id = ?").run(now(), clusterId);
  emit?.("cluster_updated", { id: clusterId, status: "analyzing" });

  try {
    const messages = db.prepare("SELECT * FROM messages WHERE cluster_id = ? ORDER BY timestamp ASC").all(clusterId);
    await prepareMedia(messages);
    await classifyMessages(messages, force);

    if (depth < 8) {
      const linked = relinkOpenClusters(clusterId);
      if (linked.merged) {
        analyzeLocks.delete(clusterId);
        return analyzeCluster(linked.id, emit, { depth: depth + 1, force });
      }
    }

    const extracted = await extractGroup(messages);
    const fresh = getCluster(clusterId);
    const auto = await autoApplyCluster(fresh, extracted, emit);
    if (auto) return auto;

    db.prepare(
      "UPDATE clusters SET status = 'needs_review', kind = ?, extracted_json = ?, confidence = ?, error = ?, analyzed_at = ?, updated_at = ? WHERE id = ?"
    ).run(
      extracted.kind || "other",
      JSON.stringify(extracted),
      extracted.confidence ?? 0,
      extracted.error || "",
      now(),
      now(),
      clusterId
    );
  } catch (err) {
    db.prepare("UPDATE clusters SET status = 'needs_review', error = ?, updated_at = ? WHERE id = ?").run(
      String(err.message || err),
      now(),
      clusterId
    );
  } finally {
    analyzeLocks.delete(clusterId);
  }

  const current = db.prepare("SELECT id, status FROM clusters WHERE id = ?").get(clusterId);
  if (!current) return null;
  if (current.status === "confirmed" || current.status === "dismissed") {
    const done = getCluster(clusterId);
    emit?.("cluster_updated", done);
    return done;
  }
  if (depth < 8) {
    const linked = relinkOpenClusters(clusterId);
    if (linked.merged) {
      return analyzeCluster(linked.id, emit, { depth: depth + 1, force });
    }
  }

  const updated = getCluster(clusterId);
  emit?.("cluster_updated", updated);
  return updated;
}

function decorateMessage(msg) {
  const name = msg.media_path ? String(msg.media_path).split(/[/\\]/).pop() : "";
  return {
    ...msg,
    media_url: name ? `/media/${name}` : "",
    intent: parseJson(msg.intent_json, null),
  };
}

export function getCluster(clusterId) {
  const cluster = db.prepare("SELECT * FROM clusters WHERE id = ?").get(clusterId);
  if (!cluster) return null;
  const messages = db
    .prepare("SELECT * FROM messages WHERE cluster_id = ? ORDER BY timestamp ASC")
    .all(clusterId)
    .map(decorateMessage);
  const extracted = parseJson(cluster.extracted_json, {});
  return {
    ...cluster,
    kind: cluster.kind || extracted.kind || "",
    extracted,
    messages,
  };
}

export function listInbox() {
  const rows = db
    .prepare(
      `SELECT c.* FROM clusters c
       WHERE c.status IN ('collecting', 'analyzing', 'needs_review')
       ORDER BY c.updated_at DESC`
    )
    .all();
  return rows.map((c) => {
    const messages = db
      .prepare("SELECT * FROM messages WHERE cluster_id = ? ORDER BY timestamp ASC")
      .all(c.id)
      .map(decorateMessage);
    const extracted = parseJson(c.extracted_json, {});
    return { ...c, kind: c.kind || extracted.kind || "", extracted, messages };
  });
}

function confirmOrder(cluster, body, ts) {
  const customerName = String(body.customer_name || "").trim();
  if (!customerName) throw new Error("اسم العميل مطلوب");
  const customer = findOrCreateCustomer(customerName, { phone: body.phone || "" });
  const jobId = uid();
  const sizes =
    Array.isArray(body.sizes) && body.sizes.length
      ? body.sizes.map((s) => ({
          width: Number(s.width || 0) || null,
          height: Number(s.height || 0) || null,
          quantity: Number(s.quantity || 1) || 1,
        }))
      : body.width || body.height
        ? [{ width: Number(body.width) || null, height: Number(body.height) || null, quantity: Number(body.quantity || 1) || 1 }]
        : [];
  const quantity = sizes.reduce((n, s) => n + Number(s.quantity || 1), 0) || Number(body.quantity || 1) || 1;
  const width = sizes[0]?.width ?? (body.width ? Number(body.width) : null);
  const height = sizes[0]?.height ?? (body.height ? Number(body.height) : null);

  db.prepare(
    `INSERT INTO jobs (id, cluster_id, customer_id, customer_name, width, height, quantity, color_type, status, notes, sizes_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`
  ).run(
    jobId,
    cluster.id,
    customer.id,
    customer.name,
    width,
    height,
    quantity,
    body.color_type || "",
    body.notes || "",
    JSON.stringify(sizes),
    ts,
    ts
  );

  let invoice = null;
  const total = Number(body.total || 0);
  const unitPrice = Number(body.unit_price || 0);
  const invoiceTotal = total || unitPrice * quantity;
  if (invoiceTotal > 0) {
    const invoiceId = uid();
    const number = nextInvoiceNumber();
    db.prepare(
      `INSERT INTO invoices (id, number, customer_id, job_id, unit_price, quantity, total, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      invoiceId,
      number,
      customer.id,
      jobId,
      unitPrice || invoiceTotal / quantity,
      quantity,
      invoiceTotal,
      body.invoice_notes || "",
      ts
    );
    invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId);
  }

  let payment = null;
  const payAmount = Number(body.amount || 0);
  if (payAmount > 0) {
    payment = createPayment({
      customer_id: customer.id,
      amount: payAmount,
      method: body.method || "cash",
      notes: body.payment_notes || "دفعة مع الطلب",
    });
  }

  const confirmed = {
    kind: "order",
    customer_name: customer.name,
    phone: body.phone || "",
    width,
    height,
    quantity,
    color_type: body.color_type || "",
    notes: body.notes || "",
    sizes,
    auto_applied: false,
  };
  rememberExample(cluster, confirmed);
  upsertDictionary("customer", customer.name, customer.name);
  if (body.color_type) upsertDictionary("color", body.color_type, body.color_type);
  db.prepare(
    "UPDATE clusters SET status = 'confirmed', kind = 'order', extracted_json = ?, auto_applied = 0, updated_at = ? WHERE id = ?"
  ).run(JSON.stringify(confirmed), ts, cluster.id);

  return {
    kind: "order",
    cluster: getCluster(cluster.id),
    job: db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId),
    invoice,
    payment,
    customer,
  };
}

function confirmPayment(cluster, body, ts) {
  const customerName = String(body.customer_name || "").trim();
  const amount = Number(body.amount || 0);
  if (!customerName) throw new Error("اسم العميل مطلوب");
  if (amount <= 0) throw new Error("مبلغ الدفعة مطلوب");
  const customer = findOrCreateCustomer(customerName, { phone: body.phone || "" });
  const payment = createPayment({
    customer_id: customer.id,
    amount,
    method: body.method || "cash",
    notes: body.notes || "",
  });
  const confirmed = {
    kind: "payment",
    customer_name: customer.name,
    amount,
    method: body.method || "cash",
    notes: body.notes || "",
    auto_applied: false,
  };
  rememberExample(cluster, confirmed);
  db.prepare(
    "UPDATE clusters SET status = 'confirmed', kind = 'payment', extracted_json = ?, auto_applied = 0, updated_at = ? WHERE id = ?"
  ).run(JSON.stringify(confirmed), ts, cluster.id);
  return { kind: "payment", cluster: getCluster(cluster.id), payment, customer };
}

function confirmContact(cluster, body, ts) {
  const customerName = String(body.customer_name || "").trim();
  const phone = String(body.phone || "").trim();
  if (!customerName) throw new Error("اسم العميل مطلوب");
  if (!phone) throw new Error("رقم التليفون مطلوب");
  const customer = findOrCreateCustomer(customerName, { phone });
  updateCustomer(customer.id, { phone });
  const confirmed = {
    kind: "customer_contact",
    customer_name: customer.name,
    phone,
    notes: body.notes || "",
    auto_applied: false,
  };
  rememberExample(cluster, confirmed);
  upsertDictionary("customer", customer.name, customer.name);
  db.prepare(
    "UPDATE clusters SET status = 'confirmed', kind = 'customer_contact', extracted_json = ?, auto_applied = 0, updated_at = ? WHERE id = ?"
  ).run(JSON.stringify(confirmed), ts, cluster.id);
  return { kind: "customer_contact", cluster: getCluster(cluster.id), customer };
}

function confirmPrice(cluster, body, ts) {
  const itemKey = String(body.color_type || body.item_key || "").trim();
  const unitPrice = Number(body.unit_price || 0);
  const price = upsertPrice(itemKey, unitPrice, body.notes || "");
  if (itemKey) upsertDictionary("color", itemKey, itemKey);
  const confirmed = {
    kind: "price_update",
    color_type: itemKey,
    unit_price: unitPrice,
    notes: body.notes || "",
    auto_applied: false,
  };
  rememberExample(cluster, confirmed);
  db.prepare(
    "UPDATE clusters SET status = 'confirmed', kind = 'price_update', extracted_json = ?, auto_applied = 0, updated_at = ? WHERE id = ?"
  ).run(JSON.stringify(confirmed), ts, cluster.id);
  return { kind: "price_update", cluster: getCluster(cluster.id), price };
}

export function confirmCluster(clusterId, body) {
  const cluster = getCluster(clusterId);
  if (!cluster) throw new Error("الشغلة غير موجودة");
  const kind = body.kind || cluster.kind || cluster.extracted?.kind || "order";
  const ts = now();
  db.exec("BEGIN");
  try {
    let result;
    if (kind === "payment") result = confirmPayment(cluster, body, ts);
    else if (kind === "customer_contact") result = confirmContact(cluster, body, ts);
    else if (kind === "price_update") result = confirmPrice(cluster, body, ts);
    else if (kind === "ignore") {
      dismissCluster(clusterId);
      result = { kind: "ignore", cluster: getCluster(clusterId) };
    } else result = confirmOrder(cluster, body, ts);
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function dismissCluster(clusterId) {
  db.prepare("UPDATE clusters SET status = 'dismissed', updated_at = ? WHERE id = ?").run(now(), clusterId);
  return getCluster(clusterId);
}

export function mergeClusters(targetId, sourceId) {
  if (targetId === sourceId) throw new Error("لا يمكن دمج الشغلة مع نفسها");
  const target = db.prepare("SELECT * FROM clusters WHERE id = ?").get(targetId);
  const source = db.prepare("SELECT * FROM clusters WHERE id = ?").get(sourceId);
  if (!target || !source) throw new Error("الشغلة غير موجودة");
  db.prepare("UPDATE messages SET cluster_id = ? WHERE cluster_id = ?").run(targetId, sourceId);
  db.prepare("DELETE FROM clusters WHERE id = ?").run(sourceId);
  db.prepare("UPDATE clusters SET status = 'collecting', updated_at = ? WHERE id = ?").run(now(), targetId);
  return getCluster(targetId);
}

export function splitCluster(clusterId, messageIds = []) {
  const ids = Array.isArray(messageIds) ? messageIds.filter(Boolean) : [];
  if (!ids.length) throw new Error("اختر رسايل للفصل");
  const cluster = db.prepare("SELECT * FROM clusters WHERE id = ?").get(clusterId);
  if (!cluster) throw new Error("الشغلة غير موجودة");
  const newId = uid();
  const ts = now();
  db.prepare(
    "INSERT INTO clusters (id, chat_jid, status, created_at, updated_at) VALUES (?, ?, 'collecting', ?, ?)"
  ).run(newId, cluster.chat_jid, ts, ts);
  const stmt = db.prepare("UPDATE messages SET cluster_id = ? WHERE id = ? AND cluster_id = ?");
  for (const mid of ids) stmt.run(newId, mid, clusterId);
  db.prepare("UPDATE clusters SET status = 'collecting', updated_at = ? WHERE id = ?").run(ts, clusterId);
  return { original: getCluster(clusterId), created: getCluster(newId) };
}

export function saveIncomingMessage(row) {
  if (row.wa_id) {
    const existing = db.prepare("SELECT * FROM messages WHERE wa_id = ?").get(row.wa_id);
    if (existing) return decorateMessage(existing);
  }
  const clusterId = assignCluster(row);
  const id = uid();
  db.prepare(
    `INSERT INTO messages (id, wa_id, chat_jid, sender_jid, sender_name, timestamp, type, text, transcription, media_path, mime_type, quoted_wa_id, cluster_id, created_at, from_me)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    row.wa_id,
    row.chat_jid,
    row.sender_jid,
    row.sender_name || "",
    row.timestamp || now(),
    row.type,
    row.text || "",
    row.transcription || "",
    row.media_path || "",
    row.mime_type || "",
    row.quoted_wa_id || "",
    clusterId,
    now(),
    row.from_me ? 1 : 0
  );
  db.prepare(
    "UPDATE clusters SET updated_at = ?, status = CASE WHEN status = 'needs_review' THEN 'collecting' ELSE status END WHERE id = ?"
  ).run(now(), clusterId);
  return decorateMessage({ ...db.prepare("SELECT * FROM messages WHERE id = ?").get(id), cluster_id: clusterId });
}
