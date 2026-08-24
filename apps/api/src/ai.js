import fs from "node:fs";
import path from "node:path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSetting, listDictionary, setSetting } from "./db.js";
import { db } from "./db.js";
import { parseJson, toEnglishDigits } from "./utils.js";

const MODEL_CANDIDATES = [
  "gemini-3.6-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-1.5-flash",
];

const COLOR_WORDS = /(أبيض|ابيض|أخضر|اخضر|بني|بيج|أسود|اسود|أنتيك|انتيك|رمادي|ذهبي|فضي)/;

function getClient() {
  const key = getSetting("gemini_api_key", process.env.GEMINI_API_KEY || "");
  if (!key) return null;
  return new GoogleGenerativeAI(key);
}

function modelName() {
  return getSetting("gemini_model", "gemini-3.6-flash") || "gemini-3.6-flash";
}

function workshopContext() {
  const dict = listDictionary();
  const examples = db
    .prepare("SELECT input_text, extracted_json FROM learning_examples ORDER BY created_at DESC LIMIT 8")
    .all();
  const customers = db.prepare("SELECT name FROM customers ORDER BY created_at DESC LIMIT 30").all();
  return { dict, examples, customers };
}

export function parseSizesFromText(text) {
  const t = toEnglishDigits(text || "");
  const re = /(\d+(?:\.\d+)?)\s*(?:[xX×*☆★✗✕⋆∙·]|في|على)\s*(\d+(?:\.\d+)?)/g;
  const sizes = [];
  let match;
  while ((match = re.exec(t))) {
    sizes.push({
      width: Number(match[1]),
      height: Number(match[2]),
      quantity: 1,
    });
  }
  return sizes;
}

export function fallbackExtract(text) {
  const t = toEnglishDigits(text || "");
  const sizes = parseSizesFromText(t);

  const qtyMatch =
    t.match(/(?:عدد|كميه|كمية|كم)\s*[:\-]?\s*(\d+)/i) ||
    t.match(/(\d+)\s*(?:ضلف(?:ه|ة|ات)?|قطع(?:ة)?|قطعة)/i);

  const dict = listDictionary().filter((d) => d.kind === "color" || d.kind === "type");
  let colorType = "";
  for (const item of dict) {
    if (t.includes(item.key) || t.includes(item.value || "")) {
      colorType = item.value || item.key;
      break;
    }
  }
  if (!colorType) {
    const colorMatch = t.match(COLOR_WORDS);
    colorType = colorMatch ? colorMatch[1] : "";
  }

  const custMatch =
    t.match(/(?:عميل|العميل|الزبون|اسم)\s*[:\-]?\s*([^\n]{2,40})/i) ||
    t.match(/((?:استاذ|أستاذ|أ\/|ا\/|الحاج|الحج|مدام)\s+[^\n\d]{2,30})/i);

  let customerName = custMatch ? custMatch[1].replace(/[-:|]/g, "").trim() : "";
  if (!customerName) {
    const lines = t
      .split(/\n+/)
      .map((l) => l.replace(/^\[.*?\]\s*\(.*?\)\s*:?\s*/, "").trim())
      .filter(Boolean);
    const skip = new RegExp(`(?:[x×*☆★]|في|\\d|عدد|لون|سلك|مقاس|ارتفاع|عرض|${COLOR_WORDS.source})`, "i");
    const nameLine = lines.find((l) => l.length >= 2 && l.length <= 40 && !skip.test(l));
    customerName = nameLine || "";
  }
  if (COLOR_WORDS.test(customerName) && customerName.length <= 8) customerName = "";

  const quantity = qtyMatch ? Number(qtyMatch[1]) : sizes.length || 1;
  const extracted = {
    customer_name: customerName,
    width: sizes[0]?.width ?? null,
    height: sizes[0]?.height ?? null,
    quantity,
    color_type: colorType,
    notes: sizes.length > 1 ? sizes.map((s) => `${s.width}×${s.height}`).join(" ، ") : "",
    sizes,
  };

  const filled = [extracted.customer_name, extracted.width, extracted.color_type].filter(Boolean).length;
  extracted.confidence = filled / 3;
  return extracted;
}

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  return parseJson(raw.slice(start, end + 1), null);
}

async function generateWithFallback(parts) {
  const client = getClient();
  if (!client) throw new Error("no-gemini");
  const preferred = modelName();
  const models = [preferred, ...MODEL_CANDIDATES.filter((m) => m !== preferred)];
  let lastError = null;
  for (const name of models) {
    try {
      const model = client.getGenerativeModel({
        model: name,
        generationConfig: { temperature: 0.2 },
      });
      const result = await model.generateContent(parts);
      if (name !== preferred) setSetting("gemini_model", name);
      return result.response.text().trim();
    } catch (err) {
      lastError = err;
      const msg = String(err.message || err);
      if (!/404|not found|no longer available|not supported/i.test(msg)) throw err;
    }
  }
  throw lastError || new Error("gemini failed");
}

export async function transcribeAudio(filePath, mimeType) {
  const client = getClient();
  if (!client || !filePath || !fs.existsSync(filePath)) return "";
  const buf = fs.readFileSync(filePath);
  return generateWithFallback([
    {
      inlineData: {
        mimeType: mimeType || "audio/ogg",
        data: buf.toString("base64"),
      },
    },
    { text: "فرّغ التسجيل الصوتي بالعربي بدقة. أرجع النص فقط بدون مقدمات." },
  ]);
}

export async function analyzeImage(filePath, mimeType) {
  const client = getClient();
  if (!client || !filePath || !fs.existsSync(filePath)) return "";
  const buf = fs.readFileSync(filePath);
  return generateWithFallback([
    {
      inlineData: {
        mimeType: mimeType || "image/jpeg",
        data: buf.toString("base64"),
      },
    },
    {
      text: `هذه صورة من ورشة تصنيع ضلف سلك بلسي.
استخرج كل المقاسات الظاهرة (عرض وارتفاع بالسم)، العدد، اللون، وأي كتابة.
أرجع فقرة عربية قصيرة بالمعلومات فقط. المقاس ممكن يكون مكتوب 120×80 أو 120*80 أو 100☆99.5`,
    },
  ]);
}

export async function extractJob(messages) {
  const parts = [];
  for (const msg of messages) {
    const who = msg.sender_name || msg.sender_jid || "موظف";
    const body = [msg.text, msg.transcription].filter(Boolean).join("\n");
    parts.push(`[${who}] (${msg.type}): ${body || "(بدون نص)"}`);
  }
  const combined = parts.join("\n");
  const fallback = fallbackExtract(combined);
  if (!getClient()) return { ...fallback, source: "fallback", raw_text: combined };

  const { dict, examples, customers } = workshopContext();
  const prompt = `أنت محلل طلبات لورشة تصنيع ضلف السلك البلسي في مصر.
الرسايل جاية من جروب واتساب وممكن تكون متفرقة: صورة مقاس، بعدها اسم عميل، بعدها تفاصيل، وممكن صوت متفرّغ.

استخرج JSON فقط:
{
  "customer_name": "اسم العميل أو فارغ",
  "width": رقم أول مقاس أو null,
  "height": رقم أول مقاس أو null,
  "quantity": مجموع عدد الضلف,
  "color_type": "اللون أو نوع السلك",
  "notes": "تفاصيل إضافية",
  "sizes": [{"width": رقم, "height": رقم, "quantity": رقم}],
  "confidence": رقم من 0 إلى 1
}

قواعد:
- المقاس عرض × ارتفاع بالسم. الفواصل الممكنة: × * x ☆ ★ في
- ممكن يكون في أكتر من مقاس، كل سطر مقاس ضلفة.
- اللون (أبيض/اخضر/بني...) مش اسم عميل.
- لو الاسم مش واضح خليه فارغ.

عملاء معروفين:
${customers.map((c) => `- ${c.name}`).join("\n") || "(لا يوجد بعد)"}

قاموس الورشة:
${dict.map((d) => `- ${d.kind}: ${d.key} = ${d.value}`).join("\n") || "(فارغ)"}

أمثلة تصحيح سابقة:
${examples
    .map((e) => `مدخل:\n${e.input_text}\nالنتيجة:\n${e.extracted_json}`)
    .join("\n---\n") || "(لا يوجد)"}

الرسايل:
${combined}`;

  try {
    const text = await generateWithFallback(prompt);
    const parsed = extractJson(text);
    if (!parsed) return { ...fallback, source: "fallback", raw_text: combined };
    const sizes = Array.isArray(parsed.sizes) && parsed.sizes.length ? parsed.sizes : fallback.sizes;
    return {
      customer_name: parsed.customer_name || fallback.customer_name || "",
      width: parsed.width ?? sizes[0]?.width ?? fallback.width,
      height: parsed.height ?? sizes[0]?.height ?? fallback.height,
      quantity: parsed.quantity || sizes.reduce((n, s) => n + Number(s.quantity || 1), 0) || fallback.quantity || 1,
      color_type: parsed.color_type || fallback.color_type || "",
      notes: parsed.notes || fallback.notes || "",
      sizes,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : fallback.confidence,
      source: "gemini",
      raw_text: combined,
    };
  } catch (err) {
    return { ...fallback, source: "fallback", error: String(err.message || err), raw_text: combined };
  }
}

const PAYMENT_RE = /عربون|دفعة|دفعه|دفع|اتدفع|اتدفعت|مدفوع|تحويل|انستا|إنستا|instapay|كاش|فلوس|مبلغ/;
const PRICE_RE = /سعر(?:\s*ال)?(?:متر|ضلف(?:ه|ة)?|سلك)?|تسعير|اسعار|أسعار|الأسعار|الاسعار/;
const IGNORE_RE =
  /^(صباح(?:\s+الخير)?|مساء(?:\s+الخير)?|السلام عليكم|وعليكم السلام|تمام+$|تم+$|اوك+$|ok+$|👍|🙏|ههه+|lol+|حياك|الله يبارك)[\s!.]*$/i;
const ORDER_KINDS = new Set(["order", "order_fragment"]);

function messageBody(msg) {
  return [msg?.text, msg?.transcription].filter(Boolean).join("\n").trim();
}

export function extractPhone(text) {
  const compact = toEnglishDigits(text || "").replace(/[\s\-().]/g, "");
  const match = compact.match(/(?:\+?20)?0?1[0125]\d{8}/);
  if (!match) return "";
  let phone = match[0].replace(/^\+?20/, "");
  if (phone.startsWith("1") && phone.length === 10) phone = `0${phone}`;
  if (!phone.startsWith("0") && phone.length === 10) phone = `0${phone}`;
  return phone;
}

function extractAmount(text) {
  const t = toEnglishDigits(text || "");
  const labeled = t.match(
    /(?:عربون|دفعة|دفعه|دفع|اتدفع|اتدفعت|مدفوع|تحويل|مبلغ|فلوس)\s*[:\-]?\s*(\d{2,7}(?:\.\d+)?)\s*(?:جنيه|جنية|ج\.م|جم|ج)?/i
  );
  if (labeled) return Number(labeled[1]);
  const trailing = t.match(/(\d{2,7}(?:\.\d+)?)\s*(?:جنيه|جنية|ج\.م|جم|ج)\b/);
  if (trailing) return Number(trailing[1]);
  return null;
}

function extractUnitPrice(text) {
  const t = toEnglishDigits(text || "");
  const labeled = t.match(
    /(?:سعر(?:\s*ال)?(?:متر|ضلف(?:ه|ة)?|سلك)?|تسعير)\s*[^\d]{0,24}(\d{2,6}(?:\.\d+)?)/i
  );
  if (labeled) return Number(labeled[1]);
  const money = t.match(/(\d{2,6}(?:\.\d+)?)\s*(?:جنيه|جنية|ج\.م|جم|ج)\b/);
  if (money) return Number(money[1]);
  return null;
}

function paymentMethod(text) {
  const t = toEnglishDigits(text || "");
  if (/انستا|إنستا|instapay/i.test(t)) return "instapay";
  if (/بنك|تحويل/i.test(t)) return "bank";
  if (/كاش|نقد/i.test(t)) return "cash";
  return "";
}

export function fallbackClassify(text) {
  const t = toEnglishDigits(text || "").trim();
  const extracted = fallbackExtract(t);
  const phone = extractPhone(t);
  const amount = extractAmount(t);
  const unitPrice = extractUnitPrice(t);
  const hasSizes = Boolean(extracted.sizes?.length);
  const paymentHint = PAYMENT_RE.test(t);
  const priceHint = PRICE_RE.test(t);

  if (!t || t.length < 2 || (!hasSizes && !phone && !paymentHint && !priceHint && IGNORE_RE.test(t))) {
    return {
      kind: "ignore",
      customer_name: "",
      phone: "",
      amount: null,
      method: "",
      unit_price: null,
      color_type: "",
      width: null,
      height: null,
      quantity: 1,
      sizes: [],
      notes: t,
      confidence: t ? 0.9 : 0.4,
      source: "fallback",
    };
  }

  if (phone && !hasSizes && !paymentHint) {
    const leftover = leftoverName(t, [phone]);
    return {
      kind: "customer_contact",
      customer_name: extracted.customer_name || leftover,
      phone,
      amount: null,
      method: "",
      unit_price: null,
      color_type: extracted.color_type || "",
      width: null,
      height: null,
      quantity: 1,
      sizes: [],
      notes: t,
      confidence: extracted.customer_name || leftover ? 0.9 : 0.62,
      source: "fallback",
    };
  }

  if (paymentHint && !hasSizes) {
    const leftover = leftoverName(t, [amount]);
    const customerName = extracted.customer_name || leftover;
    return {
      kind: "payment",
      customer_name: customerName,
      phone: phone || "",
      amount,
      method: paymentMethod(t) || "cash",
      unit_price: null,
      color_type: "",
      width: null,
      height: null,
      quantity: 1,
      sizes: [],
      notes: t,
      confidence: amount && customerName ? 0.88 : amount ? 0.7 : 0.55,
      source: "fallback",
    };
  }

  if (priceHint && !hasSizes) {
    return {
      kind: "price_update",
      customer_name: "",
      phone: "",
      amount: null,
      method: "",
      unit_price: unitPrice,
      color_type: extracted.color_type || leftoverName(t, [unitPrice]),
      width: null,
      height: null,
      quantity: 1,
      sizes: [],
      notes: t,
      confidence: unitPrice && extracted.color_type ? 0.9 : unitPrice ? 0.72 : 0.5,
      source: "fallback",
    };
  }

  if (hasSizes) {
    const complete = Boolean(extracted.customer_name && extracted.color_type);
    return {
      kind: complete ? "order" : "order_fragment",
      ...extracted,
      phone: phone || "",
      amount: null,
      method: "",
      unit_price: null,
      notes: extracted.notes || t,
      confidence: complete ? Math.max(extracted.confidence, 0.8) : Math.min(extracted.confidence || 0.55, 0.7),
      source: "fallback",
    };
  }

  if (extracted.customer_name && t.length <= 40 && !paymentHint && !priceHint) {
    return {
      kind: "order_fragment",
      ...extracted,
      phone: phone || "",
      amount: null,
      method: "",
      unit_price: null,
      sizes: [],
      notes: t,
      confidence: 0.55,
      source: "fallback",
    };
  }

  return {
    kind: "other",
    ...extracted,
    phone: phone || "",
    amount: amount || null,
    method: paymentMethod(t),
    unit_price: unitPrice,
    notes: t,
    confidence: 0.35,
    source: "fallback",
  };
}

function leftoverName(text, extras = []) {
  let s = toEnglishDigits(text || "");
  for (const extra of extras) {
    if (extra != null && extra !== "") s = s.replace(String(extra), " ");
  }
  s = s
    .replace(PAYMENT_RE, " ")
    .replace(PRICE_RE, " ")
    .replace(/ضلف(?:ه|ة)?|سلك|متر|جنيه|جنية|ج\.م|\bجم\b|\bج\b/g, " ")
    .replace(/\d+(?:\.\d+)?/g, " ")
    .replace(/[:\-_|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length >= 2 && s.length <= 40 && !COLOR_WORDS.test(s)) return s;
  return "";
}

function emptyIntent() {
  return {
    kind: "other",
    customer_name: "",
    phone: "",
    amount: null,
    method: "",
    unit_price: null,
    color_type: "",
    width: null,
    height: null,
    quantity: 1,
    sizes: [],
    notes: "",
    confidence: 0,
    source: "fallback",
  };
}

function normalizeIntent(parsed, fallback) {
  const sizes = Array.isArray(parsed?.sizes) && parsed.sizes.length ? parsed.sizes : fallback.sizes || [];
  const kind = parsed?.kind || fallback.kind || "other";
  return {
    kind,
    customer_name: parsed?.customer_name || fallback.customer_name || "",
    phone: extractPhone(parsed?.phone || "") || fallback.phone || "",
    amount: parsed?.amount ?? fallback.amount ?? null,
    method: parsed?.method || fallback.method || "",
    unit_price: parsed?.unit_price ?? fallback.unit_price ?? null,
    color_type: parsed?.color_type || fallback.color_type || "",
    width: parsed?.width ?? sizes[0]?.width ?? fallback.width ?? null,
    height: parsed?.height ?? sizes[0]?.height ?? fallback.height ?? null,
    quantity: parsed?.quantity || fallback.quantity || sizes.reduce((n, s) => n + Number(s.quantity || 1), 0) || 1,
    sizes,
    notes: parsed?.notes || fallback.notes || "",
    confidence: typeof parsed?.confidence === "number" ? parsed.confidence : fallback.confidence || 0,
    source: parsed ? "gemini" : fallback.source || "fallback",
  };
}

export async function classifyMessage(msg) {
  const body = messageBody(msg);
  const fallback = fallbackClassify(body);
  if (!body) return { ...fallback, kind: fallback.kind === "ignore" ? "ignore" : fallback.kind };

  if (!getClient()) return fallback;

  const { dict, examples, customers } = workshopContext();
  const prompt = `أنت مصنف رسايل لجروب ورشة ضلف سلك بلسي في مصر.
صنّف الرسالة الواحدة فقط. مش كل رسالة طلب تصنيع.

أرجع JSON فقط:
{
  "kind": "order|order_fragment|customer_contact|payment|price_update|ignore|other",
  "customer_name": "",
  "phone": "",
  "amount": null,
  "method": "cash|instapay|bank|",
  "unit_price": null,
  "color_type": "",
  "width": null,
  "height": null,
  "quantity": 1,
  "sizes": [{"width": رقم, "height": رقم, "quantity": رقم}],
  "notes": "",
  "confidence": 0.0
}

المعاني:
- order: طلب تصنيع مكتمل أو شبه مكتمل (مقاس + غالبا اسم أو لون)
- order_fragment: جزء طلب (مقاس لوحده، اسم لوحده، لون لوحده)
- customer_contact: رقم تليفون، غالبا مع اسم
- payment: دفع / عربون / تحويل / اتدفع
- price_update: تحديث سعر المتر أو الضلفة أو اللون
- ignore: سلام، تمام، تم، صباح الخير، كلام فاضي
- other: مش واضح

قواعد:
- الرقم المصري 01xxxxxxxxx نوعه customer_contact لو مفيش مقاس.
- كلمات عربون/دفع/تحويل/اتدفع نوعها payment.
- اللون مش اسم عميل.
- لو مش واثق خفّض confidence.

عملاء معروفين:
${customers.map((c) => `- ${c.name}`).join("\n") || "(لا يوجد بعد)"}

قاموس الورشة:
${dict.map((d) => `- ${d.kind}: ${d.key} = ${d.value}`).join("\n") || "(فارغ)"}

أمثلة سابقة:
${examples
    .map((e) => `مدخل:\n${e.input_text}\nالنتيجة:\n${e.extracted_json}`)
    .join("\n---\n") || "(لا يوجد)"}

الرسالة:
${body}`;

  try {
    const text = await generateWithFallback(prompt);
    const parsed = extractJson(text);
    if (!parsed) return fallback;
    const intent = normalizeIntent(parsed, fallback);
    if (fallback.kind === "customer_contact" && fallback.phone && !intent.sizes?.length) {
      return { ...intent, ...fallback, kind: "customer_contact", source: "hybrid" };
    }
    if (fallback.kind === "payment" && fallback.amount && intent.kind === "order") {
      return { ...intent, ...fallback, kind: "payment", source: "hybrid" };
    }
    if (fallback.kind === "price_update" && fallback.unit_price && !intent.sizes?.length) {
      return { ...intent, ...fallback, kind: "price_update", source: "hybrid" };
    }
    return intent;
  } catch (err) {
    return { ...fallback, error: String(err.message || err) };
  }
}

export function mergeIntents(intents, messages = []) {
  const list = (intents || []).filter((i) => i && i.kind);
  if (!list.length) {
    const combined = messages.map(messageBody).filter(Boolean).join("\n");
    return combined ? fallbackClassify(combined) : emptyIntent();
  }

  const kinds = list.map((i) => i.kind);
  const sizes = list.flatMap((i) => i.sizes || []).filter((s) => s.width || s.height);
  const names = list.map((i) => i.customer_name).filter(Boolean);
  const colors = list.map((i) => i.color_type).filter(Boolean);
  const phones = list.map((i) => i.phone).filter(Boolean);
  const amounts = list.map((i) => Number(i.amount || 0)).filter((n) => n > 0);
  const prices = list.map((i) => Number(i.unit_price || 0)).filter((n) => n > 0);
  const methods = list.map((i) => i.method).filter(Boolean);
  const notes = list.map((i) => i.notes).filter(Boolean);
  const confidences = list.map((i) => Number(i.confidence || 0));
  const avg = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;

  const hasOrder = kinds.some((k) => ORDER_KINDS.has(k)) || sizes.length;
  let kind = "other";
  if (hasOrder) kind = names[0] && (sizes.length || colors[0]) ? "order" : "order_fragment";
  else if (kinds.includes("payment")) kind = "payment";
  else if (kinds.includes("customer_contact")) kind = "customer_contact";
  else if (kinds.includes("price_update")) kind = "price_update";
  else if (kinds.every((k) => k === "ignore")) kind = "ignore";

  if (kinds.includes("payment") && hasOrder) {
    notes.push(amounts[0] ? `دفعة ${amounts[0]}` : "فيها دفعة");
  }

  return {
    kind,
    customer_name: names[0] || "",
    phone: phones[0] || "",
    amount: amounts[0] || null,
    method: methods[0] || "",
    unit_price: prices[0] || null,
    color_type: colors[0] || "",
    width: sizes[0]?.width ?? null,
    height: sizes[0]?.height ?? null,
    quantity: sizes.reduce((n, s) => n + Number(s.quantity || 1), 0) || 1,
    sizes,
    notes: notes.join(" | "),
    confidence: hasOrder && names[0] && sizes.length ? Math.max(avg, 0.72) : avg,
    source: list.some((i) => i.source === "gemini" || i.source === "hybrid") ? "merged" : "fallback",
  };
}

function sameCustomer(a, b) {
  const left = String(a?.customer_name || "").trim();
  const right = String(b?.customer_name || "").trim();
  if (!left || !right) return false;
  return (
    left.replace(/\s+/g, "") === right.replace(/\s+/g, "") ||
    left.includes(right) ||
    right.includes(left)
  );
}

function complementaryOrder(a, b) {
  const aSize = Boolean(a.sizes?.length || a.width);
  const bSize = Boolean(b.sizes?.length || b.width);
  const aName = Boolean(a.customer_name);
  const bName = Boolean(b.customer_name);
  const aColor = Boolean(a.color_type);
  const bColor = Boolean(b.color_type);
  if (aName && bName && !sameCustomer(a, b)) return false;
  if (aSize && bSize && aName && bName) return sameCustomer(a, b);
  if (aSize && bSize && !aName && !bName) return false;
  return (
    (aSize && !bSize && (bName || bColor)) ||
    (bSize && !aSize && (aName || aColor)) ||
    (aName && !bName && (bSize || bColor)) ||
    (bName && !aName && (aSize || aColor)) ||
    (aColor && !bColor && (bSize || bName)) ||
    (bColor && !aColor && (aSize || aName))
  );
}

export function shouldLink(a, b, meta = {}) {
  if (!a?.kind || !b?.kind) return false;
  if (a.kind === "ignore" || b.kind === "ignore") return false;
  if (a.kind === "other" && b.kind === "other") return false;

  const aOrder = ORDER_KINDS.has(a.kind);
  const bOrder = ORDER_KINDS.has(b.kind);

  if ((a.kind === "price_update" || b.kind === "price_update") && a.kind !== b.kind) return false;
  if (a.kind === "price_update" && b.kind === "price_update") return Boolean(meta.sameSender);

  if (aOrder && bOrder) {
    if (sameCustomer(a, b)) return true;
    if (meta.sameSender && complementaryOrder(a, b)) return true;
    return complementaryOrder(a, b) && Boolean(a.customer_name || b.customer_name);
  }

  if ((a.kind === "payment" && bOrder) || (b.kind === "payment" && aOrder)) {
    return sameCustomer(a, b);
  }

  if ((a.kind === "customer_contact" && bOrder) || (b.kind === "customer_contact" && aOrder)) {
    return sameCustomer(a, b);
  }

  if (a.kind === "payment" && b.kind === "payment") return sameCustomer(a, b) || Boolean(meta.sameSender);
  if (a.kind === "customer_contact" && b.kind === "customer_contact") {
    return sameCustomer(a, b) || (Boolean(meta.sameSender) && (a.phone || b.phone));
  }

  return false;
}

export async function extractGroup(messages) {
  const intents = messages.map((m) => {
    const stored = parseJson(m.intent_json, null);
    return stored?.kind ? stored : fallbackClassify(messageBody(m));
  });
  const merged = mergeIntents(intents, messages);
  if (merged.kind === "order" || merged.kind === "order_fragment") {
    const job = await extractJob(messages);
    const complete = Boolean(job.customer_name && (job.sizes?.length || job.width));
    return {
      ...merged,
      ...job,
      kind: complete ? "order" : "order_fragment",
      phone: merged.phone || "",
      amount: merged.amount,
      method: merged.method,
    };
  }
  return merged;
}

export function mediaAbsPath(rel) {
  if (!rel) return "";
  return path.join(process.cwd(), rel);
}
