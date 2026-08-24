"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../lib/api";
import { clusterKind, clusterStatusLabel, clusterSummary, dt, jobStatusLabel, kindBadgeClass, kindLabel, money, sizeText } from "../lib/format";
import { useLiveReload } from "../lib/socket";

export default function HomePage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api("/api/dashboard")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useLiveReload(load);

  if (!data) {
    return <div className="card">{error || "جاري التحميل..."}</div>;
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>لوحة الورشة</h1>
          <p>الرسايل بتتجمع من الجروب، والشغل والحسابات من هنا.</p>
        </div>
        <Link className="btn brass" href="/inbox">
          مراجعة الوارد
        </Link>
      </div>

      <div className="grid stats">
        <div className="card stat">
          <span>شغل في المراجعة</span>
          <b>{data.inbox}</b>
        </div>
        <div className="card stat">
          <span>شغل مفتوح</span>
          <b>{data.jobsOpen}</b>
        </div>
        <div className="card stat">
          <span>متبقي على العملاء</span>
          <b>{money(data.due)}</b>
        </div>
        <div className="card stat">
          <span>الصندوق / البنك</span>
          <b>
            {money(data.cash)} / {money(data.bank)}
          </b>
        </div>
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>آخر شغل مرشح</h3>
          {data.recentInbox?.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>النوع</th>
                  <th>الحالة</th>
                  <th>الوقت</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.recentInbox.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <span className={`badge ${kindBadgeClass(clusterKind(c))}`}>{kindLabel(clusterKind(c))}</span>
                    </td>
                    <td>
                      <span className="badge review">{clusterStatusLabel(c.status)}</span>
                    </td>
                    <td>{dt(c.updated_at)}</td>
                    <td>
                      <Link href={`/inbox/${c.id}`}>فتح</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">مفيش شغل في الانتظار. اربط الواتساب وحدد الجروب.</div>
          )}
        </div>
        <div className="card">
          <h3>آخر أوامر التصنيع</h3>
          {data.recentJobs?.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>العميل</th>
                  <th>المقاس</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {data.recentJobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <Link href={`/jobs/${j.id}`}>{j.customer_name}</Link>
                    </td>
                    <td>{sizeText(j)}</td>
                    <td>{jobStatusLabel(j.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">لسه مفيش أوامر مؤكدة.</div>
          )}
        </div>
      </div>

      {data.recentApplied?.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>اتسجل تلقائي</h3>
          <table className="table">
            <thead>
              <tr>
                <th></th>
                <th>النوع</th>
                <th>التفاصيل</th>
                <th>الوقت</th>
              </tr>
            </thead>
            <tbody>
              {data.recentApplied.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span className="badge ok">اتسجل تلقائي</span>
                  </td>
                  <td>
                    <span className={`badge ${kindBadgeClass(clusterKind(c))}`}>{kindLabel(clusterKind(c))}</span>
                  </td>
                  <td>{clusterSummary(c)}</td>
                  <td>{dt(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
