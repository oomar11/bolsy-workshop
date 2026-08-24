"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useWaStatus } from "../../lib/socket";

export default function WhatsAppPage() {
  const wa = useWaStatus();
  const [groups, setGroups] = useState([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (wa?.status === "connected") {
      api("/api/whatsapp/groups").then(setGroups).catch((e) => setError(e.message));
    }
  }, [wa?.status]);

  async function selectGroup(jid) {
    setBusy(true);
    setError("");
    try {
      await api("/api/whatsapp/group", { method: "POST", body: JSON.stringify({ jid }) });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await api("/api/whatsapp/logout", { method: "POST", body: "{}" });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>ربط الواتساب</h1>
          <p>امسح QR من واتساب ← الأجهزة المرتبطة، وبعدين حدد جروب الشغل.</p>
        </div>
        {wa?.status === "connected" && (
          <button className="btn danger" onClick={logout} disabled={busy}>
            فصل الحساب
          </button>
        )}
      </div>

      {error && <div className="notice">{error}</div>}

      <div className="grid two">
        <div className="card">
          <h3>حالة الاتصال</h3>
          <p>
            {wa?.status === "connected" && "متصل"}
            {wa?.status === "qr" && "استنى المسح"}
            {wa?.status === "connecting" && "بيحاول يتصل..."}
            {wa?.status === "disconnected" && "مش متصل"}
            {!wa && "جاري التحقق من الاتصال..."}
          </p>
          {wa?.user?.id && <p>الحساب: {wa.user.id}</p>}
          {wa?.lastError && wa?.status !== "qr" && <p>{wa.lastError}</p>}
          {wa?.qr && (
            <div className="qr-box">
              <img src={wa.qr} alt="QR" />
            </div>
          )}
          {wa?.status !== "qr" && wa?.status !== "connected" && (
            <div className="empty">لو QR مش ظاهرة، استنى لحظات أو أعد تشغيل البرنامج.</div>
          )}
        </div>
        <div className="card">
          <h3>اختيار الجروب</h3>
          {wa?.status !== "connected" ? (
            <div className="empty">وصل الواتساب الأول عشان تظهر الجروبات.</div>
          ) : (
            <>
              <p>المحدد حاليًا: <strong>{wa.selectedName || "لا شيء"}</strong></p>
              <div className="field">
                <label>بحث في الجروبات</label>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="اكتب اسم الجروب" />
              </div>
              <div className="field">
                <label>جروب التصنيع</label>
                <select
                  value={wa.selectedJid || ""}
                  onChange={(e) => selectGroup(e.target.value)}
                  disabled={busy}
                >
                  <option value="">— اختار جروب —</option>
                  {groups
                    .filter((g) => !query || String(g.name || "").includes(query))
                    .map((g) => (
                      <option key={g.jid} value={g.jid}>
                        {g.name} ({g.size})
                      </option>
                    ))}
                </select>
              </div>
              <p>البرنامج هيسمع الجروب المحدد فقط. لو بتبعت في جروب تاني مش هيظهر هنا.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
