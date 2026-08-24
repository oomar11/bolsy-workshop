"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { dt, money } from "../../lib/format";

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({ customer_id: "", unit_price: "", quantity: 1, total: "", notes: "" });
  const [error, setError] = useState("");

  function load() {
    api("/api/invoices").then(setInvoices);
    api("/api/customers").then(setCustomers);
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e) {
    e.preventDefault();
    try {
      await api("/api/invoices", { method: "POST", body: JSON.stringify(form) });
      setForm({ customer_id: "", unit_price: "", quantity: 1, total: "", notes: "" });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>الفواتير</h1>
          <p>كل فاتورة بتزيد رصيد العميل لحد ما تتسدد.</p>
        </div>
      </div>
      {error && <div className="notice">{error}</div>}
      <div className="grid two">
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>رقم</th>
                <th>العميل</th>
                <th>الإجمالي</th>
                <th>التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.number}</td>
                  <td>
                    <Link href={`/customers/${inv.customer_id}`}>{inv.customer_name}</Link>
                  </td>
                  <td>{money(inv.total)}</td>
                  <td>{dt(inv.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="card" onSubmit={create}>
          <h3>فاتورة يدوي</h3>
          <div className="field">
            <label>العميل</label>
            <select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
              <option value="">—</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid form">
            <div className="field">
              <label>العدد</label>
              <input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </div>
            <div className="field">
              <label>سعر الوحدة</label>
              <input value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>الإجمالي</label>
            <input value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} />
          </div>
          <div className="field">
            <label>ملاحظة</label>
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <button className="btn" type="submit">حفظ</button>
        </form>
      </div>
    </div>
  );
}
