"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import { dt, money, sizeText } from "../../../lib/format";

export default function CustomerPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [pay, setPay] = useState({ amount: "", method: "cash", notes: "" });
  const [error, setError] = useState("");

  function load() {
    api(`/api/customers/${id}`).then(setData).catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
  }, [id]);

  async function addPayment(e) {
    e.preventDefault();
    await api("/api/payments", {
      method: "POST",
      body: JSON.stringify({
        customer_id: id,
        amount: pay.amount,
        method: pay.method,
        account: pay.method === "cash" ? "cash" : "bank",
        notes: pay.notes,
      }),
    });
    setPay({ amount: "", method: "cash", notes: "" });
    load();
  }

  if (!data) return <div className="card">{error || "جاري التحميل..."}</div>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{data.name}</h1>
          <p>
            عليه {money(data.invoiced)} · دفع {money(data.paid)} · المتبقي {money(data.balance)}
          </p>
        </div>
        <button className="btn secondary no-print" onClick={() => window.print()}>
          طباعة الكشف
        </button>
      </div>

      <div className="grid two">
        <div className="card">
          <h3>كشف الحساب</h3>
          <table className="table">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>البيان</th>
                <th>عليه</th>
                <th>له</th>
                <th>الرصيد</th>
              </tr>
            </thead>
            <tbody>
              {data.statement?.map((row) => (
                <tr key={row.id}>
                  <td>{dt(row.at)}</td>
                  <td>{row.label}</td>
                  <td>{row.debit ? money(row.debit) : "—"}</td>
                  <td>{row.credit ? money(row.credit) : "—"}</td>
                  <td>{money(row.running)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <form className="card no-print" onSubmit={addPayment}>
            <h3>تسجيل دفعة</h3>
            <div className="field">
              <label>المبلغ</label>
              <input value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
            </div>
            <div className="field">
              <label>الطريقة</label>
              <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                <option value="cash">كاش</option>
                <option value="instapay">إنستاباي</option>
                <option value="bank">بنك</option>
              </select>
            </div>
            <div className="field">
              <label>ملاحظة</label>
              <input value={pay.notes} onChange={(e) => setPay({ ...pay, notes: e.target.value })} />
            </div>
            <button className="btn" type="submit">حفظ الدفعة</button>
          </form>
          <div className="card" style={{ marginTop: 16 }}>
            <h3>الشغل</h3>
            {data.jobs?.map((j) => (
              <div key={j.id}>
                {sizeText(j)} · {j.quantity} · {j.color_type || "—"}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
