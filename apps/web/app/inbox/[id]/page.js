"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, mediaSrc } from "../../../lib/api";
import { clusterKind, clusterStatusLabel, dt, kindBadgeClass, kindLabel } from "../../../lib/format";
import { useLiveReload } from "../../../lib/socket";

const emptyForm = {
  kind: "order",
  customer_name: "",
  phone: "",
  amount: "",
  method: "cash",
  width: "",
  height: "",
  quantity: 1,
  color_type: "",
  notes: "",
  unit_price: "",
  total: "",
  sizes: [{ width: "", height: "", quantity: 1 }],
};

function confirmLabel(kind) {
  if (kind === "payment") return "تسجيل الدفعة";
  if (kind === "customer_contact") return "حفظ رقم العميل";
  if (kind === "price_update") return "حفظ السعر";
  if (kind === "ignore") return "تجاهل";
  return "تأكيد وتسجيل التصنيع";
}

function redirectFor(kind) {
  if (kind === "payment") return "/payments";
  if (kind === "customer_contact") return "/customers";
  if (kind === "price_update") return "/settings";
  return "/jobs";
}

export default function ReviewPage() {
  const { id } = useParams();
  const router = useRouter();
  const [cluster, setCluster] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [selected, setSelected] = useState([]);
  const [others, setOthers] = useState([]);
  const [mergeId, setMergeId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const filled = useRef(false);
  const dirty = useRef(false);
  const load = useCallback(
    (fillForm = false) => {
      api(`/api/clusters/${id}`)
        .then((data) => {
          setCluster(data);
          const ex = data.extracted || {};
          const kind = data.kind || ex.kind || "order";
          if ((fillForm || !filled.current) && !dirty.current) {
            filled.current = true;
            const sizes =
              Array.isArray(ex.sizes) && ex.sizes.length
                ? ex.sizes
                : ex.width || ex.height
                  ? [{ width: ex.width || "", height: ex.height || "", quantity: ex.quantity || 1 }]
                  : [{ width: "", height: "", quantity: 1 }];
            setForm((prev) => ({
              ...prev,
              kind,
              customer_name: ex.customer_name || "",
              phone: ex.phone || "",
              amount: ex.amount || "",
              method: ex.method || "cash",
              width: sizes[0]?.width || "",
              height: sizes[0]?.height || "",
              quantity: ex.quantity || sizes.length || 1,
              color_type: ex.color_type || "",
              notes: ex.notes || "",
              unit_price: ex.unit_price || "",
              sizes,
            }));
          }
        })
        .catch((e) => setError(e.message));
      api("/api/inbox").then((rows) => setOthers(rows.filter((r) => r.id !== id)));
    },
    [id]
  );

  useEffect(() => {
    filled.current = false;
    load(true);
  }, [id, load]);
  useLiveReload(() => load(false));

  function setField(key, value) {
    dirty.current = true;
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setSize(index, key, value) {
    dirty.current = true;
    setForm((f) => {
      const sizes = (f.sizes || []).map((s, i) => (i === index ? { ...s, [key]: value } : s));
      return {
        ...f,
        sizes,
        width: sizes[0]?.width || "",
        height: sizes[0]?.height || "",
        quantity: sizes.reduce((n, s) => n + Number(s.quantity || 1), 0) || 1,
      };
    });
  }

  function addSize() {
    dirty.current = true;
    setForm((f) => ({ ...f, sizes: [...(f.sizes || []), { width: "", height: "", quantity: 1 }] }));
  }

  function removeSize(index) {
    dirty.current = true;
    setForm((f) => {
      const sizes = (f.sizes || []).filter((_, i) => i !== index);
      return { ...f, sizes: sizes.length ? sizes : [{ width: "", height: "", quantity: 1 }] };
    });
  }

  async function analyze() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/clusters/${id}/analyze`, { method: "POST", body: "{}" });
      filled.current = false;
      load(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError("");
    const kind = form.kind || clusterKind(cluster) || "order";
    try {
      if (kind === "ignore") {
        await api(`/api/clusters/${id}/dismiss`, { method: "POST", body: "{}" });
        router.push("/inbox");
        return;
      }
      await api(`/api/clusters/${id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ ...form, kind }),
      });
      router.push(redirectFor(kind));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    try {
      await api(`/api/clusters/${id}/dismiss`, { method: "POST", body: "{}" });
      router.push("/inbox");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function split() {
    setBusy(true);
    try {
      const result = await api(`/api/clusters/${id}/split`, {
        method: "POST",
        body: JSON.stringify({ messageIds: selected }),
      });
      router.push(`/inbox/${result.created.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function merge() {
    if (!mergeId) return;
    setBusy(true);
    try {
      await api(`/api/clusters/${id}/merge`, {
        method: "POST",
        body: JSON.stringify({ otherId: mergeId }),
      });
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!cluster) return <div className="card">{error || "جاري التحميل..."}</div>;

  const kind = form.kind || clusterKind(cluster) || "order";

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>مراجعة {kindLabel(kind)}</h1>
          <p>
            <span className={`badge ${cluster.status === "needs_review" ? "review" : "info"}`}>
              {clusterStatusLabel(cluster.status)}
            </span>{" "}
            <span className={`badge ${kindBadgeClass(kind)}`}>{kindLabel(kind)}</span>{" "}
            {cluster.auto_applied ? <span className="badge ok">اتسجل تلقائي</span> : null}{" "}
            {cluster.confidence != null ? `الثقة ${(Number(cluster.confidence) * 100).toFixed(0)}%` : ""}
          </p>
        </div>
        <div className="row-actions no-print">
          <button className="btn secondary" onClick={analyze} disabled={busy}>
            تحليل دلوقتي
          </button>
          <button className="btn danger" onClick={dismiss} disabled={busy}>
            تجاهل
          </button>
          <button className="btn" onClick={confirm} disabled={busy}>
            {confirmLabel(kind)}
          </button>
        </div>
      </div>
      {error && <div className="notice">{error}</div>}
      {cluster.error && <div className="notice">{cluster.error}</div>}

      <div className="split">
        <div className="card">
          <h3>الرسايل المرتبطة</h3>
          <div className="msg-list">
            {cluster.messages.map((msg) => (
              <label key={msg.id} className="msg">
                <header>
                  <span>
                    <input
                      type="checkbox"
                      checked={selected.includes(msg.id)}
                      onChange={(e) => {
                        setSelected((s) => (e.target.checked ? [...s, msg.id] : s.filter((x) => x !== msg.id)));
                      }}
                    />{" "}
                    {msg.sender_name || msg.sender_jid} · {msg.type}{" "}
                    {msg.intent?.kind ? (
                      <span className={`badge ${kindBadgeClass(msg.intent.kind)}`}>{kindLabel(msg.intent.kind)}</span>
                    ) : null}
                  </span>
                  <span>{dt(msg.timestamp)}</span>
                </header>
                {msg.text && <div>{msg.text}</div>}
                {msg.type === "image" && msg.media_url && <img src={mediaSrc(msg.media_url)} alt="مقاس" />}
                {msg.type === "audio" && msg.media_url && <audio controls src={mediaSrc(msg.media_url)} />}
                {msg.transcription && <div className="ocr">{msg.transcription}</div>}
              </label>
            ))}
          </div>
          <div className="row-actions" style={{ marginTop: 12 }}>
            <button className="btn secondary" disabled={!selected.length || busy} onClick={split}>
              فصل الرسايل المحددة
            </button>
          </div>
          {others.length > 0 && (
            <div className="field" style={{ marginTop: 16 }}>
              <label>دمج مع شغلة تانية</label>
              <select value={mergeId} onChange={(e) => setMergeId(e.target.value)}>
                <option value="">—</option>
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {kindLabel(clusterKind(o))} · {o.extracted?.customer_name || o.id.slice(0, 8)} ({o.messages.length} رسايل)
                  </option>
                ))}
              </select>
              <button className="btn secondary" disabled={!mergeId || busy} onClick={merge}>
                دمج
              </button>
            </div>
          )}
        </div>

        <div className="card">
          <div className="field">
            <label>نوع التسجيل</label>
            <select value={kind} onChange={(e) => setField("kind", e.target.value)}>
              <option value="order">طلب تصنيع</option>
              <option value="order_fragment">جزء طلب</option>
              <option value="payment">دفعة</option>
              <option value="customer_contact">رقم تليفون</option>
              <option value="price_update">تحديث سعر</option>
              <option value="ignore">كلام عادي</option>
            </select>
          </div>

          {(kind === "order" || kind === "order_fragment") && (
            <>
              <h3>بيانات الشغلة</h3>
              <div className="field">
                <label>اسم العميل</label>
                <input value={form.customer_name} onChange={(e) => setField("customer_name", e.target.value)} />
              </div>
              <div className="field">
                <label>رقم التليفون (اختياري)</label>
                <input value={form.phone} onChange={(e) => setField("phone", e.target.value)} />
              </div>
              <div className="field">
                <label>المقاسات (سم)</label>
                {(form.sizes || []).map((s, i) => (
                  <div className="grid form" key={i}>
                    <input placeholder="عرض" value={s.width} onChange={(e) => setSize(i, "width", e.target.value)} />
                    <input placeholder="ارتفاع" value={s.height} onChange={(e) => setSize(i, "height", e.target.value)} />
                    <input placeholder="عدد" value={s.quantity} onChange={(e) => setSize(i, "quantity", e.target.value)} />
                    <button type="button" className="btn ghost" onClick={() => removeSize(i)}>
                      حذف
                    </button>
                  </div>
                ))}
                <button type="button" className="btn secondary" onClick={addSize}>
                  إضافة مقاس
                </button>
              </div>
              <div className="field">
                <label>اللون / النوع</label>
                <input value={form.color_type} onChange={(e) => setField("color_type", e.target.value)} />
              </div>
              <div className="field">
                <label>ملاحظات</label>
                <textarea value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
              </div>
              <h3>فاتورة اختيارية</h3>
              <div className="grid form">
                <div className="field">
                  <label>سعر الوحدة</label>
                  <input value={form.unit_price} onChange={(e) => setField("unit_price", e.target.value)} />
                </div>
                <div className="field">
                  <label>الإجمالي</label>
                  <input value={form.total} onChange={(e) => setField("total", e.target.value)} />
                </div>
              </div>
              {(form.amount || cluster.extracted?.amount) && (
                <>
                  <h3>دفعة مرتبطة</h3>
                  <div className="grid form">
                    <div className="field">
                      <label>المبلغ</label>
                      <input value={form.amount} onChange={(e) => setField("amount", e.target.value)} />
                    </div>
                    <div className="field">
                      <label>طريقة الدفع</label>
                      <select value={form.method} onChange={(e) => setField("method", e.target.value)}>
                        <option value="cash">كاش</option>
                        <option value="instapay">إنستاباي</option>
                        <option value="bank">بنك</option>
                      </select>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {kind === "payment" && (
            <>
              <h3>تسجيل دفعة</h3>
              <div className="field">
                <label>اسم العميل</label>
                <input value={form.customer_name} onChange={(e) => setField("customer_name", e.target.value)} />
              </div>
              <div className="field">
                <label>المبلغ</label>
                <input value={form.amount} onChange={(e) => setField("amount", e.target.value)} />
              </div>
              <div className="field">
                <label>طريقة الدفع</label>
                <select value={form.method} onChange={(e) => setField("method", e.target.value)}>
                  <option value="cash">كاش</option>
                  <option value="instapay">إنستاباي</option>
                  <option value="bank">بنك</option>
                </select>
              </div>
              <div className="field">
                <label>ملاحظات</label>
                <textarea value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
              </div>
            </>
          )}

          {kind === "customer_contact" && (
            <>
              <h3>رقم العميل</h3>
              <div className="field">
                <label>اسم العميل</label>
                <input value={form.customer_name} onChange={(e) => setField("customer_name", e.target.value)} />
              </div>
              <div className="field">
                <label>رقم التليفون</label>
                <input value={form.phone} onChange={(e) => setField("phone", e.target.value)} />
              </div>
              <div className="field">
                <label>ملاحظات</label>
                <textarea value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
              </div>
            </>
          )}

          {kind === "price_update" && (
            <>
              <h3>تحديث السعر</h3>
              <div className="field">
                <label>اللون / النوع</label>
                <input value={form.color_type} onChange={(e) => setField("color_type", e.target.value)} />
              </div>
              <div className="field">
                <label>سعر الوحدة</label>
                <input value={form.unit_price} onChange={(e) => setField("unit_price", e.target.value)} />
              </div>
              <div className="field">
                <label>ملاحظات</label>
                <textarea value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
              </div>
            </>
          )}

          {kind === "ignore" && (
            <p className="empty">الرسالة دي كلام عادي. ممكن تتجاهلها من غير ما تدخل الشغل أو الحسابات.</p>
          )}
        </div>
      </div>
    </div>
  );
}
