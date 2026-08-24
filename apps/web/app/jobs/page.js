"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { dt, jobStatusLabel, sizeText } from "../../lib/format";

export default function JobsPage() {
  const [jobs, setJobs] = useState([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const q = status ? `/api/jobs?status=${status}` : "/api/jobs";
    api(q).then(setJobs).catch((e) => setError(e.message));
  }, [status]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>سجل التصنيع</h1>
          <p>كل الضلف المؤكدة وحالتها من أول الورشة لحد التسليم.</p>
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">كل الحالات</option>
          <option value="new">جديد</option>
          <option value="in_progress">جاري التصنيع</option>
          <option value="ready">جاهز</option>
          <option value="delivered">اتسلم</option>
        </select>
      </div>
      {error && <div className="notice">{error}</div>}
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>العميل</th>
              <th>المقاس</th>
              <th>العدد</th>
              <th>اللون / النوع</th>
              <th>الحالة</th>
              <th>التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>
                  <Link href={`/jobs/${job.id}`}>{job.customer_name}</Link>
                </td>
                <td>{sizeText(job)}</td>
                <td>{job.quantity}</td>
                <td>{job.color_type || "—"}</td>
                <td>{jobStatusLabel(job.status)}</td>
                <td>{dt(job.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!jobs.length && <div className="empty">مفيش شغل في السجل.</div>}
      </div>
    </div>
  );
}
