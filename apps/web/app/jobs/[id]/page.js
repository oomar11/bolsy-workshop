"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, mediaSrc } from "../../../lib/api";
import { dt, jobStatusLabel, money, sizeText } from "../../../lib/format";

export default function JobPage() {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [invoice, setInvoice] = useState({ unit_price: "", total: "" });

  async function load() {
    const data = await api(`/api/jobs/${id}`);
    setJob(data);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [id]);

  async function setStatus(status) {
    await api(`/api/jobs/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    load();
  }

  async function addInvoice() {
    await api("/api/invoices", {
      method: "POST",
      body: JSON.stringify({
        customer_id: job.customer_id,
        job_id: job.id,
        quantity: job.quantity,
        unit_price: invoice.unit_price,
        total: invoice.total,
      }),
    });
    load();
  }

  if (!job) return <div className="card">{error || "جاري التحميل..."}</div>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{job.customer_name}</h1>
          <p>
            {sizeText(job)} · عدد {job.quantity} · {job.color_type || "بدون لون"}
          </p>
        </div>
        <div className="row-actions">
          {["new", "in_progress", "ready", "delivered"].map((s) => (
            <button key={s} className="btn secondary" onClick={() => setStatus(s)}>
              {jobStatusLabel(s)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <p>الحالة الحالية: {jobStatusLabel(job.status)}</p>
          <p>التاريخ: {dt(job.created_at)}</p>
          {job.notes && <p>ملاحظات: {job.notes}</p>}
          <p>
            <Link href={`/customers/${job.customer_id}`}>حساب العميل</Link>
          </p>
          {job.invoice ? (
            <p>فاتورة رقم {job.invoice.number} — {money(job.invoice.total)}</p>
          ) : (
            <div>
              <h3>إنشاء فاتورة</h3>
              <div className="grid form">
                <div className="field">
                  <label>سعر الوحدة</label>
                  <input value={invoice.unit_price} onChange={(e) => setInvoice({ ...invoice, unit_price: e.target.value })} />
                </div>
                <div className="field">
                  <label>الإجمالي</label>
                  <input value={invoice.total} onChange={(e) => setInvoice({ ...invoice, total: e.target.value })} />
                </div>
              </div>
              <button className="btn" onClick={addInvoice}>حفظ الفاتورة</button>
            </div>
          )}
        </div>
        <div className="card">
          <h3>مصدر الواتساب</h3>
          {job.cluster?.messages?.length ? (
            <div className="msg-list">
              {job.cluster.messages.map((msg) => (
                <div key={msg.id} className="msg">
                  <header>
                    <span>{msg.sender_name}</span>
                    <span>{dt(msg.timestamp)}</span>
                  </header>
                  {msg.text && <div>{msg.text}</div>}
                  {msg.type === "image" && msg.media_url && <img src={mediaSrc(msg.media_url)} alt="" />}
                  {msg.type === "audio" && msg.media_url && <audio controls src={mediaSrc(msg.media_url)} />}
                  {msg.transcription && <div className="ocr">{msg.transcription}</div>}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">الشغلة اتسجلت من غير رسايل محفوظة.</div>
          )}
        </div>
      </div>
    </div>
  );
}
