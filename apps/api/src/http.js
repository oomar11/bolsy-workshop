import express from "express";
import cors from "cors";
import path from "node:path";
import { MEDIA_DIR } from "./utils.js";
import { db, getSettings, listDictionary, listPrices, setSetting, upsertDictionary, upsertPrice } from "./db.js";
import {
  analyzeCluster,
  confirmCluster,
  dismissCluster,
  getCluster,
  listInbox,
  mergeClusters,
  splitCluster,
} from "./engine.js";
import {
  accountStatement,
  createCustomer,
  createInvoice,
  createMovement,
  createPayment,
  customerStatement,
  dashboard,
  getCustomer,
  groupStatement,
  listCustomers,
  listInvoices,
  listJobs,
  listPayments,
  unifiedStatement,
  updateCustomer,
  updateJob,
} from "./accounting.js";
import { getWaState, logoutWhatsApp, refreshGroups, selectGroup, reactLikeToMessages } from "./whatsapp.js";

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function createApp(io) {
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "12mb" }));
  app.use("/media", express.static(MEDIA_DIR));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.get("/api/dashboard", (_req, res) => res.json(dashboard()));
  app.get("/api/settings", (_req, res) => {
    const settings = getSettings();
    res.json({
      ...settings,
      gemini_api_key: settings.gemini_api_key ? "••••••••" : "",
      has_gemini_key: Boolean(settings.gemini_api_key),
    });
  });
  app.put(
    "/api/settings",
    asyncHandler(async (req, res) => {
      const allowed = [
        "workshop_name",
        "gemini_api_key",
        "gemini_model",
        "cluster_window_ms",
        "analyze_delay_ms",
      ];
      for (const key of allowed) {
        if (req.body[key] !== undefined && req.body[key] !== "••••••••") {
          setSetting(key, req.body[key]);
        }
      }
      res.json({ ok: true, settings: getSettings() });
    })
  );

  app.get("/api/whatsapp/status", (_req, res) => res.json(getWaState()));
  app.get(
    "/api/whatsapp/groups",
    asyncHandler(async (_req, res) => {
      const groups = await refreshGroups();
      res.json(groups);
    })
  );
  app.post(
    "/api/whatsapp/group",
    asyncHandler(async (req, res) => {
      res.json(await selectGroup(req.body.jid || ""));
    })
  );
  app.post(
    "/api/whatsapp/logout",
    asyncHandler(async (_req, res) => {
      await logoutWhatsApp();
      res.json({ ok: true });
    })
  );

  app.get("/api/inbox", (_req, res) => res.json(listInbox()));
  app.get("/api/clusters/:id", (req, res) => {
    const cluster = getCluster(req.params.id);
    if (!cluster) return res.status(404).json({ error: "غير موجود" });
    res.json(cluster);
  });
  app.post(
    "/api/clusters/:id/analyze",
    asyncHandler(async (req, res) => {
      const result = await analyzeCluster(req.params.id, (event, payload) => io.emit(event, payload), { force: true });
      res.json(result);
    })
  );
  app.post(
    "/api/clusters/:id/confirm",
    asyncHandler(async (req, res) => {
      const result = confirmCluster(req.params.id, req.body || {});
      const likes = await reactLikeToMessages(result.cluster?.messages || []);
      res.json({ ...result, likes });
    })
  );
  app.post("/api/clusters/:id/dismiss", (req, res) => {
    res.json(dismissCluster(req.params.id));
  });
  app.post("/api/clusters/:id/merge", (req, res) => {
    res.json(mergeClusters(req.params.id, req.body.otherId));
  });
  app.post("/api/clusters/:id/split", (req, res) => {
    res.json(splitCluster(req.params.id, req.body.messageIds || []));
  });

  app.get("/api/jobs", (req, res) => res.json(listJobs(req.query.status)));
  app.get("/api/jobs/:id", (req, res) => {
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(req.params.id);
    if (!job) return res.status(404).json({ error: "غير موجود" });
    const cluster = job.cluster_id ? getCluster(job.cluster_id) : null;
    const invoice = db.prepare("SELECT * FROM invoices WHERE job_id = ?").get(job.id);
    let sizes = [];
    try {
      sizes = job.sizes_json ? JSON.parse(job.sizes_json) : [];
    } catch {
      sizes = [];
    }
    res.json({ ...job, sizes, cluster, invoice });
  });
  app.patch("/api/jobs/:id", (req, res) => res.json(updateJob(req.params.id, req.body || {})));

  app.get("/api/customers", (_req, res) => res.json(listCustomers()));
  app.post("/api/customers", (req, res) => res.json(createCustomer(req.body || {})));
  app.get("/api/customers/:id", (req, res) => {
    const customer = getCustomer(req.params.id);
    if (!customer) return res.status(404).json({ error: "غير موجود" });
    res.json({ ...customer, statement: customerStatement(customer.id) });
  });
  app.patch("/api/customers/:id", (req, res) => res.json(updateCustomer(req.params.id, req.body || {})));

  app.get("/api/invoices", (_req, res) => res.json(listInvoices()));
  app.post("/api/invoices", (req, res) => res.json(createInvoice(req.body || {})));

  app.get("/api/payments", (_req, res) => res.json(listPayments()));
  app.post("/api/payments", (req, res) => res.json(createPayment(req.body || {})));

  app.get("/api/ledger/:account", (req, res) => {
    const account = req.params.account === "bank" ? "bank" : "cash";
    res.json(accountStatement(account));
  });
  app.post("/api/ledger/movement", (req, res) => res.json(createMovement(req.body || {})));
  app.get("/api/statements/unified", (_req, res) => res.json(unifiedStatement()));
  app.post("/api/statements/group", (req, res) => res.json(groupStatement(req.body.customerIds || [])));

  app.get("/api/dictionary", (_req, res) => res.json(listDictionary()));
  app.post("/api/dictionary", (req, res) => {
    upsertDictionary(req.body.kind || "color", req.body.key, req.body.value || req.body.key);
    res.json(listDictionary());
  });
  app.delete("/api/dictionary/:id", (req, res) => {
    db.prepare("DELETE FROM dictionary WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  app.get("/api/prices", (_req, res) => res.json(listPrices()));
  app.post("/api/prices", (req, res) => {
    res.json(upsertPrice(req.body.item_key || req.body.color_type, req.body.unit_price, req.body.notes || ""));
  });

  app.get("/api/media-file", (req, res) => {
    const file = String(req.query.path || "");
    if (!file.startsWith(MEDIA_DIR)) return res.status(400).end();
    res.sendFile(file);
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(400).json({ error: err.message || "حصل خطأ" });
  });

  return app;
}

export function mediaUrl(absPath) {
  if (!absPath) return "";
  const name = path.basename(absPath);
  return `/media/${name}`;
}
