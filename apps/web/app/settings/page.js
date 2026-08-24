"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    workshop_name: "",
    gemini_api_key: "",
    gemini_model: "gemini-2.0-flash",
    cluster_window_ms: "",
    analyze_delay_ms: "",
    has_gemini_key: false,
  });
  const [dict, setDict] = useState([]);
  const [prices, setPrices] = useState([]);
  const [item, setItem] = useState({ kind: "color", key: "", value: "" });
  const [priceItem, setPriceItem] = useState({ item_key: "", unit_price: "", notes: "" });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  function load() {
    api("/api/settings").then(setSettings);
    api("/api/dictionary").then(setDict);
    api("/api/prices").then(setPrices);
  }

  useEffect(() => {
    load();
  }, []);

  async function save(e) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
      setMsg("تم الحفظ");
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function addDict(e) {
    e.preventDefault();
    await api("/api/dictionary", { method: "POST", body: JSON.stringify(item) });
    setItem({ kind: item.kind, key: "", value: "" });
    load();
  }

  async function addPrice(e) {
    e.preventDefault();
    await api("/api/prices", { method: "POST", body: JSON.stringify(priceItem) });
    setPriceItem({ item_key: "", unit_price: "", notes: "" });
    load();
  }

  async function removeDict(id) {
    await api(`/api/dictionary/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>الإعدادات</h1>
          <p>مفتاح Gemini للتحليل الذكي، وقاموس الورشة للتعلم على اختصاراتكم.</p>
        </div>
      </div>
      {error && <div className="notice">{error}</div>}
      {msg && <div className="card">{msg}</div>}
      <div className="grid two">
        <form className="card" onSubmit={save}>
          <div className="field">
            <label>اسم الورشة</label>
            <input
              value={settings.workshop_name || ""}
              onChange={(e) => setSettings({ ...settings, workshop_name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>مفتاح Gemini</label>
            <input
              type="password"
              placeholder={settings.has_gemini_key ? "محفوظ — اكتب جديد للتغيير" : "اختياري، من Google AI Studio"}
              value={settings.gemini_api_key === "••••••••" ? "" : settings.gemini_api_key || ""}
              onChange={(e) => setSettings({ ...settings, gemini_api_key: e.target.value })}
            />
          </div>
          <div className="field">
            <label>الموديل</label>
            <input
              value={settings.gemini_model || ""}
              onChange={(e) => setSettings({ ...settings, gemini_model: e.target.value })}
            />
          </div>
          <div className="field">
            <label>نافذة ربط الرسايل (مللي ثانية)</label>
            <input
              value={settings.cluster_window_ms || ""}
              onChange={(e) => setSettings({ ...settings, cluster_window_ms: e.target.value })}
            />
          </div>
          <div className="field">
            <label>تأخير التحليل بعد آخر رسالة</label>
            <input
              value={settings.analyze_delay_ms || ""}
              onChange={(e) => setSettings({ ...settings, analyze_delay_ms: e.target.value })}
            />
          </div>
          <button className="btn" type="submit">حفظ الإعدادات</button>
        </form>
        <div className="card">
          <h3>قاموس الورشة</h3>
          <form onSubmit={addDict}>
            <div className="field">
              <label>النوع</label>
              <select value={item.kind} onChange={(e) => setItem({ ...item, kind: e.target.value })}>
                <option value="color">لون</option>
                <option value="type">نوع سلك</option>
                <option value="customer">عميل</option>
                <option value="abbreviation">اختصار</option>
              </select>
            </div>
            <div className="field">
              <label>الكلمة</label>
              <input value={item.key} onChange={(e) => setItem({ ...item, key: e.target.value })} />
            </div>
            <div className="field">
              <label>المعنى</label>
              <input value={item.value} onChange={(e) => setItem({ ...item, value: e.target.value })} />
            </div>
            <button className="btn secondary" type="submit">إضافة</button>
          </form>
          <table className="table">
            <tbody>
              {dict.map((d) => (
                <tr key={d.id}>
                  <td>{d.kind}</td>
                  <td>{d.key}</td>
                  <td>{d.value}</td>
                  <td>
                    <button className="btn ghost" onClick={() => removeDict(d.id)}>
                      حذف
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h3>قائمة الأسعار</h3>
        <form onSubmit={addPrice}>
          <div className="grid form">
            <div className="field">
              <label>اللون / النوع</label>
              <input
                value={priceItem.item_key}
                onChange={(e) => setPriceItem({ ...priceItem, item_key: e.target.value })}
              />
            </div>
            <div className="field">
              <label>سعر الوحدة</label>
              <input
                value={priceItem.unit_price}
                onChange={(e) => setPriceItem({ ...priceItem, unit_price: e.target.value })}
              />
            </div>
            <div className="field">
              <label>ملاحظات</label>
              <input
                value={priceItem.notes}
                onChange={(e) => setPriceItem({ ...priceItem, notes: e.target.value })}
              />
            </div>
          </div>
          <button className="btn secondary" type="submit">
            حفظ السعر
          </button>
        </form>
        <table className="table">
          <thead>
            <tr>
              <th>الصنف</th>
              <th>السعر</th>
              <th>ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {prices.length === 0 ? (
              <tr>
                <td colSpan={3}>لسه مفيش أسعار محفوظة.</td>
              </tr>
            ) : (
              prices.map((p) => (
                <tr key={p.id}>
                  <td>{p.item_key}</td>
                  <td>{p.unit_price}</td>
                  <td>{p.notes || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
