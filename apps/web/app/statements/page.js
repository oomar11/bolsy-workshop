"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { accountLabel, dt, money } from "../../lib/format";

export default function StatementsPage() {
  const [tab, setTab] = useState("unified");
  const [unified, setUnified] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [picked, setPicked] = useState([]);
  const [groupRows, setGroupRows] = useState([]);
  const [move, setMove] = useState({ account: "cash", type: "in", amount: "", notes: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/statements/unified").then(setUnified);
    api("/api/customers").then(setCustomers);
  }, []);

  useEffect(() => {
    if (tab === "cash" || tab === "bank") {
      api(`/api/ledger/${tab}`).then(setLedger).catch((e) => setError(e.message));
    }
  }, [tab]);

  async function addMove(e) {
    e.preventDefault();
    await api("/api/ledger/movement", { method: "POST", body: JSON.stringify(move) });
    setMove({ ...move, amount: "", notes: "" });
    api(`/api/ledger/${move.account}`).then(setLedger);
  }

  async function loadGroup() {
    const rows = await api("/api/statements/group", {
      method: "POST",
      body: JSON.stringify({ customerIds: picked }),
    });
    setGroupRows(rows);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>الكشوف</h1>
          <p>كشف موحد للعملاء، صندوق، بنك، وكشف جماعي للطباعة.</p>
        </div>
        <div className="row-actions no-print">
          {["unified", "cash", "bank", "group"].map((t) => (
            <button key={t} className={tab === t ? "btn" : "btn secondary"} onClick={() => setTab(t)}>
              {t === "unified" ? "موحد" : t === "cash" ? "صندوق" : t === "bank" ? "بنك" : "جماعي"}
            </button>
          ))}
          <button className="btn brass" onClick={() => window.print()}>
            طباعة
          </button>
        </div>
      </div>
      {error && <div className="notice">{error}</div>}

      {tab === "unified" && (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>العميل</th>
                <th>عليه</th>
                <th>مدفوع</th>
                <th>المتبقي</th>
              </tr>
            </thead>
            <tbody>
              {unified.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{money(c.invoiced)}</td>
                  <td>{money(c.paid)}</td>
                  <td>{money(c.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(tab === "cash" || tab === "bank") && (
        <div className="grid two">
          <div className="card">
            <h3>كشف {accountLabel(tab)}</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>النوع</th>
                  <th>المبلغ</th>
                  <th>الرصيد</th>
                  <th>بيان</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((row) => (
                  <tr key={row.id}>
                    <td>{dt(row.created_at)}</td>
                    <td>{row.type === "in" ? "وارد" : "منصرف"}</td>
                    <td>{money(row.amount)}</td>
                    <td>{money(row.running)}</td>
                    <td>{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form className="card no-print" onSubmit={addMove}>
            <h3>حركة يدوي</h3>
            <div className="field">
              <label>الحساب</label>
              <select
                value={move.account}
                onChange={(e) => {
                  setMove({ ...move, account: e.target.value });
                  setTab(e.target.value);
                }}
              >
                <option value="cash">الصندوق</option>
                <option value="bank">البنك</option>
              </select>
            </div>
            <div className="field">
              <label>النوع</label>
              <select value={move.type} onChange={(e) => setMove({ ...move, type: e.target.value })}>
                <option value="in">وارد</option>
                <option value="out">منصرف</option>
              </select>
            </div>
            <div className="field">
              <label>المبلغ</label>
              <input value={move.amount} onChange={(e) => setMove({ ...move, amount: e.target.value })} />
            </div>
            <div className="field">
              <label>بيان</label>
              <input value={move.notes} onChange={(e) => setMove({ ...move, notes: e.target.value })} />
            </div>
            <button className="btn" type="submit">حفظ الحركة</button>
          </form>
        </div>
      )}

      {tab === "group" && (
        <div className="grid two">
          <div className="card no-print">
            <h3>اختار العملاء</h3>
            {customers.map((c) => (
              <label key={c.id} style={{ display: "block", marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={picked.includes(c.id)}
                  onChange={(e) =>
                    setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))
                  }
                />{" "}
                {c.name} ({money(c.balance)})
              </label>
            ))}
            <button className="btn" onClick={loadGroup}>
              تجهيز الكشف
            </button>
          </div>
          <div className="card">
            <h3>كشف جماعي</h3>
            {groupRows.map((c) => (
              <div key={c.id} style={{ marginBottom: 16 }}>
                <strong>{c.name}</strong> — المتبقي {money(c.balance)}
                <div>
                  {c.statement?.slice(-4).map((s) => (
                    <div key={s.id}>
                      {dt(s.at)} · {s.label} · {money(s.running)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!groupRows.length && <div className="empty">اختار عملاء وجهّز الكشف.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
