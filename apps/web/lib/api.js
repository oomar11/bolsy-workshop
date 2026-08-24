export const API = process.env.NEXT_PUBLIC_API_URL || "/backend";

export async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "حصل خطأ");
  return data;
}

export function mediaSrc(pathOrUrl) {
  if (!pathOrUrl) return "";
  if (String(pathOrUrl).startsWith("http")) return pathOrUrl;
  if (String(pathOrUrl).startsWith("/media/")) return `${API}${pathOrUrl}`;
  const name = String(pathOrUrl).split(/[/\\]/).pop();
  return `${API}/media/${name}`;
}
