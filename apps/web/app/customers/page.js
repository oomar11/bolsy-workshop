"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { money } from "../../lib/format";

export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({ name: "", phone: "", notes: "" });
  const [error, setError] = useState("");

  function load() {
    api("/api/customers").then(setCustomers).catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e) {
    e.preventDefault();
    try {
      await api("/api/customers", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", phone: "", notes: "" });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>العملاء</h1>
          <p>الرصيد = الفواتير ناقص الدفعات.</p>
        </div>
      </div>
      {error && <div className="notice">{error}</div>}
      <div className="grid two">
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>عليه</th>
                <th>مدفوع</th>
                <th>المتبقي</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/customers/${c.id}`}>{c.name}</Link>
                  </td>
                  <td>{money(c.invoiced)}</td>
                  <td>{money(c.paid)}</td>
                  <td>{money(c.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="card" onSubmit={create}>
          <h3>عميل جديد</h3>
          <div className="field">
            <label>الاسم</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>التليفون</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="field">
            <label>ملاحظات</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <button className="btn" type="submit">حفظ</button>
        </form>
      </div>
    </div>
  );
}
