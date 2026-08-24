"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { clusterKind, clusterStatusLabel, clusterSummary, dt, kindBadgeClass, kindLabel } from "../../lib/format";
import { useLiveReload } from "../../lib/socket";

export default function InboxPage() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api("/api/inbox")
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useLiveReload(load);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>وارد الشغل</h1>
          <p>كل رسالة بتتصنف لوحدها. الطلبات والمشكوك فيها هنا للمراجعة، والدفعات والأرقام الواضحة تتسجل لوحدها.</p>
        </div>
      </div>
      {error && <div className="notice">{error}</div>}
      <div className="card">
        {items.length === 0 ? (
          <div className="empty">مفيش وارد دلوقتي.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>الحالة</th>
                <th>النوع</th>
                <th>المحتوى</th>
                <th>العميل</th>
                <th>عدد الرسايل</th>
                <th>آخر تحديث</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const kind = clusterKind(item);
                return (
                  <tr key={item.id}>
                    <td>
                      <span className={`badge ${item.status === "needs_review" ? "review" : "info"}`}>
                        {clusterStatusLabel(item.status)}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${kindBadgeClass(kind)}`}>{kindLabel(kind)}</span>
                    </td>
                    <td>{clusterSummary(item)}</td>
                    <td>{item.extracted?.customer_name || "—"}</td>
                    <td>{item.messages?.length || 0}</td>
                    <td>{dt(item.updated_at)}</td>
                    <td>
                      <Link className="btn secondary" href={`/inbox/${item.id}`}>
                        مراجعة
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
