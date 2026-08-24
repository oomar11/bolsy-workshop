"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { accountLabel, dt, methodLabel, money } from "../../lib/format";

export default function PaymentsPage() {
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({ customer_id: "", amount: "", method: "cash", notes: "" });
  const [error, setError] = useState("");

  function load() {
    api("/api/payments").then(setPayments);
    api("/api/customers").then(setCustomers);
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e) {
    e.preventDefault();
    try {
      await api("/api/payments", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          account: form.method === "cash" ? "cash" : "bank",
        }),
      });
      setForm({ customer_id: "", amount: "", method: "cash", notes: "" });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>الدفعات</h1>
          <p>الكاش يدخل الصندوق، والإنستاباي والبنك يدخلوا حركة البنك.</p>
        </div>
      </div>
      {error && <div className="notice">{error}</div>}
      <div className="grid two">
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>العميل</th>
                <th>المبلغ</th>
                <th>الطريقة</th>
                <th>الحساب</th>
                <th>التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/customers/${p.customer_id}`}>{p.customer_name}</Link>
                  </td>
                  <td>{money(p.amount)}</td>
                  <td>{methodLabel(p.method)}</td>
                  <td>{accountLabel(p.account)}</td>
                  <td>{dt(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="card" onSubmit={create}>
          <h3>دفعة جديدة</h3>
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
          <div className="field">
            <label>المبلغ</label>
            <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div className="field">
            <label>الطريقة</label>
            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              <option value="cash">كاش</option>
              <option value="instapay">إنستاباي</option>
              <option value="bank">بنك</option>
            </select>
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
