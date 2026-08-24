import { customerBalance, db, findOrCreateCustomer, nextInvoiceNumber } from "./db.js";
import { normalizeName, now, parseJson, uid } from "./utils.js";

function decorateJob(job) {
  if (!job) return job;
  return { ...job, sizes: parseJson(job.sizes_json, []) };
}

export function listCustomers() {
  return db
    .prepare("SELECT * FROM customers ORDER BY created_at DESC")
    .all()
    .map((c) => ({ ...c, ...customerBalance(c.id) }));
}

export function getCustomer(id) {
  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
  if (!customer) return null;
  const jobs = db.prepare("SELECT * FROM jobs WHERE customer_id = ? ORDER BY created_at DESC").all(id).map(decorateJob);
  const invoices = db.prepare("SELECT * FROM invoices WHERE customer_id = ? ORDER BY created_at DESC").all(id);
  const payments = db.prepare("SELECT * FROM payments WHERE customer_id = ? ORDER BY created_at DESC").all(id);
  return { ...customer, ...customerBalance(id), jobs, invoices, payments };
}

export function createCustomer(body) {
  if (!body.name) throw new Error("اسم العميل مطلوب");
  return findOrCreateCustomer(body.name, { phone: body.phone || "", notes: body.notes || "" });
}

export function updateCustomer(id, body) {
  const current = db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
  if (!current) throw new Error("العميل غير موجود");
  const name = body.name || current.name;
  db.prepare("UPDATE customers SET name = ?, name_norm = ?, phone = ?, notes = ? WHERE id = ?").run(
    name,
    normalizeName(name),
    body.phone ?? current.phone,
    body.notes ?? current.notes,
    id
  );
  return getCustomer(id);
}

export function listJobs(status) {
  const rows = status
    ? db.prepare("SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC").all(status)
    : db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all();
  return rows.map(decorateJob);
}

export function updateJob(id, body) {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  if (!job) throw new Error("الشغلة غير موجودة");
  db.prepare(
    `UPDATE jobs SET customer_name = ?, width = ?, height = ?, quantity = ?, color_type = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?`
  ).run(
    body.customer_name ?? job.customer_name,
    body.width ?? job.width,
    body.height ?? job.height,
    body.quantity ?? job.quantity,
    body.color_type ?? job.color_type,
    body.status ?? job.status,
    body.notes ?? job.notes,
    now(),
    id
  );
  return decorateJob(db.prepare("SELECT * FROM jobs WHERE id = ?").get(id));
}

export function createInvoice(body) {
  const customerId = body.customer_id;
  if (!customerId) throw new Error("العميل مطلوب");
  const quantity = Number(body.quantity || 1) || 1;
  const unitPrice = Number(body.unit_price || 0);
  const total = Number(body.total || unitPrice * quantity);
  if (total <= 0) throw new Error("مبلغ الفاتورة مطلوب");
  const id = uid();
  const number = nextInvoiceNumber();
  db.prepare(
    `INSERT INTO invoices (id, number, customer_id, job_id, unit_price, quantity, total, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, number, customerId, body.job_id || null, unitPrice || total / quantity, quantity, total, body.notes || "", now());
  return db.prepare("SELECT * FROM invoices WHERE id = ?").get(id);
}

export function listInvoices() {
  return db
    .prepare(
      `SELECT i.*, c.name AS customer_name
       FROM invoices i JOIN customers c ON c.id = i.customer_id
       ORDER BY i.created_at DESC`
    )
    .all();
}

export function createPayment(body) {
  const amount = Number(body.amount || 0);
  if (!body.customer_id) throw new Error("العميل مطلوب");
  if (amount <= 0) throw new Error("مبلغ الدفعة مطلوب");
  const method = body.method || "cash";
  const account = body.account || (method === "cash" ? "cash" : "bank");
  const id = uid();
  const ts = now();
  db.prepare(
    `INSERT INTO payments (id, customer_id, invoice_id, amount, method, account, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, body.customer_id, body.invoice_id || null, amount, method, account, body.notes || "", ts);
  db.prepare(
    `INSERT INTO cash_movements (id, account, type, amount, related_payment_id, notes, created_at)
     VALUES (?, ?, 'in', ?, ?, ?, ?)`
  ).run(uid(), account, amount, id, body.notes || `دفعة ${method}`, ts);
  return db.prepare("SELECT * FROM payments WHERE id = ?").get(id);
}

export function listPayments() {
  return db
    .prepare(
      `SELECT p.*, c.name AS customer_name
       FROM payments p JOIN customers c ON c.id = p.customer_id
       ORDER BY p.created_at DESC`
    )
    .all();
}

export function createMovement(body) {
  const amount = Number(body.amount || 0);
  if (amount <= 0) throw new Error("المبلغ مطلوب");
  const account = body.account === "bank" ? "bank" : "cash";
  const type = body.type === "out" ? "out" : "in";
  const id = uid();
  db.prepare(
    `INSERT INTO cash_movements (id, account, type, amount, related_payment_id, notes, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`
  ).run(id, account, type, amount, body.notes || "", now());
  return db.prepare("SELECT * FROM cash_movements WHERE id = ?").get(id);
}

export function accountStatement(account) {
  const rows = db
    .prepare("SELECT * FROM cash_movements WHERE account = ? ORDER BY created_at ASC")
    .all(account);
  let balance = 0;
  return rows.map((row) => {
    balance += row.type === "in" ? row.amount : -row.amount;
    return { ...row, running: balance };
  });
}

export function customerStatement(customerId) {
  const invoices = db.prepare("SELECT * FROM invoices WHERE customer_id = ?").all(customerId);
  const payments = db.prepare("SELECT * FROM payments WHERE customer_id = ?").all(customerId);
  const entries = [
    ...invoices.map((i) => ({
      id: i.id,
      at: i.created_at,
      type: "invoice",
      label: `فاتورة رقم ${i.number}`,
      debit: i.total,
      credit: 0,
    })),
    ...payments.map((p) => ({
      id: p.id,
      at: p.created_at,
      type: "payment",
      label: `دفعة (${methodLabel(p.method)})`,
      debit: 0,
      credit: p.amount,
    })),
  ].sort((a, b) => a.at - b.at);

  let running = 0;
  return entries.map((e) => {
    running += e.debit - e.credit;
    return { ...e, running };
  });
}

export function unifiedStatement() {
  return listCustomers();
}

export function groupStatement(customerIds = []) {
  const ids = customerIds.length
    ? customerIds
    : db.prepare("SELECT id FROM customers").all().map((c) => c.id);
  return ids.map((id) => getCustomer(id)).filter(Boolean);
}

export function dashboard() {
  const inbox = db
    .prepare("SELECT COUNT(*) AS n FROM clusters WHERE status IN ('collecting', 'analyzing', 'needs_review')")
    .get().n;
  const jobsOpen = db
    .prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('new', 'in_progress', 'ready')")
    .get().n;
  const customers = listCustomers();
  const due = customers.reduce((s, c) => s + (c.balance > 0 ? c.balance : 0), 0);
  const cash = accountStatement("cash");
  const bank = accountStatement("bank");
  return {
    inbox,
    jobsOpen,
    customers: customers.length,
    due,
    cash: cash.at(-1)?.running || 0,
    bank: bank.at(-1)?.running || 0,
    recentJobs: listJobs().slice(0, 6),
    recentInbox: db
      .prepare(
        "SELECT * FROM clusters WHERE status IN ('collecting', 'analyzing', 'needs_review') ORDER BY updated_at DESC LIMIT 5"
      )
      .all()
      .map((c) => ({ ...c, extracted: parseJson(c.extracted_json, {}) })),
    recentApplied: db
      .prepare("SELECT * FROM clusters WHERE auto_applied = 1 ORDER BY updated_at DESC LIMIT 6")
      .all()
      .map((c) => ({ ...c, extracted: parseJson(c.extracted_json, {}) })),
  };
}

function methodLabel(method) {
  if (method === "instapay") return "إنستاباي";
  if (method === "bank") return "بنك";
  return "كاش";
}
