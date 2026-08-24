export function money(n) {
  return new Intl.NumberFormat("ar-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));
}

export function dt(ts) {
  if (!ts) return "—";
  return new Date(Number(ts)).toLocaleString("ar-EG", {
    timeZone: "Africa/Cairo",
    calendar: "gregory",
  });
}

export function jobStatusLabel(status) {
  return (
    {
      new: "جديد",
      in_progress: "جاري التصنيع",
      ready: "جاهز",
      delivered: "اتسلم",
    }[status] || status
  );
}

export function clusterStatusLabel(status) {
  return (
    {
      collecting: "بيجمع الرسايل",
      analyzing: "بيحلّل",
      needs_review: "محتاج مراجعة",
      confirmed: "اتأكد",
      dismissed: "متروك",
    }[status] || status
  );
}

export function kindLabel(kind) {
  return (
    {
      order: "طلب تصنيع",
      order_fragment: "جزء طلب",
      customer_contact: "رقم تليفون",
      payment: "دفعة",
      price_update: "تحديث سعر",
      ignore: "كلام عادي",
      other: "مش واضح",
    }[kind] || kind || "—"
  );
}

export function kindBadgeClass(kind) {
  return (
    {
      order: "review",
      order_fragment: "review",
      customer_contact: "info",
      payment: "ok",
      price_update: "info",
      ignore: "",
      other: "warn",
    }[kind] || "info"
  );
}

export function clusterKind(item) {
  return item?.kind || item?.extracted?.kind || "";
}

export function clusterSummary(item) {
  const ex = item?.extracted || {};
  const kind = clusterKind(item);
  if (kind === "payment") {
    return [ex.customer_name, ex.amount].filter(Boolean).join(" · ") || "دفعة";
  }
  if (kind === "customer_contact") {
    return [ex.customer_name, ex.phone].filter(Boolean).join(" · ") || "رقم تليفون";
  }
  if (kind === "price_update") {
    return [ex.color_type, ex.unit_price].filter(Boolean).join(" · ") || "سعر";
  }
  if (kind === "ignore") return ex.notes || "كلام عادي";
  const sizes = (ex.sizes || [])
    .map((s) => `${s.width}×${s.height}`)
    .join(" · ");
  return sizes || (ex.width ? `${ex.width}×${ex.height}` : ex.customer_name || "—");
}

export function methodLabel(method) {
  return { cash: "كاش", instapay: "إنستاباي", bank: "بنك" }[method] || method;
}

export function accountLabel(account) {
  return { cash: "الصندوق", bank: "البنك" }[account] || account;
}

export function sizeText(job) {
  const sizes =
    (Array.isArray(job?.sizes) && job.sizes.length && job.sizes) ||
    (job?.width || job?.height
      ? [{ width: job.width, height: job.height, quantity: job.quantity || 1 }]
      : []);
  if (!sizes.length) return "—";
  return (
    sizes
      .map((s) => {
        const pair = `${s.width || "؟"} × ${s.height || "؟"}`;
        return Number(s.quantity || 1) > 1 ? `${pair} (${s.quantity})` : pair;
      })
      .join(" · ") + " سم"
  );
}
