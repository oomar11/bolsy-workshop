import { analyzeCluster, saveIncomingMessage } from "./engine.js";
import { createCustomer, createInvoice, createPayment } from "./accounting.js";

const mahmoud = createCustomer({ name: "الحاج محمود", phone: "01000000000", notes: "عميل معتاد" });
const sameh = createCustomer({ name: "استاذ سامح", phone: "01111111111" });
createInvoice({ customer_id: mahmoud.id, quantity: 3, unit_price: 450, total: 1350, notes: "ضلف بلسي ابيض" });
createPayment({ customer_id: mahmoud.id, amount: 500, method: "cash", account: "cash", notes: "عربون" });
createInvoice({ customer_id: sameh.id, quantity: 2, unit_price: 600, total: 1200 });
createPayment({ customer_id: sameh.id, amount: 1200, method: "instapay", account: "bank", notes: "سداد كامل" });

const chat = "120363-workshop@g.us";
const sender = "201000000000@s.whatsapp.net";
const t = Date.now();

const first = saveIncomingMessage({
  wa_id: `demo-${t}-1`,
  chat_jid: chat,
  sender_jid: sender,
  sender_name: "أحمد",
  timestamp: t - 80000,
  type: "text",
  text: "الحاج محمود",
});

saveIncomingMessage({
  wa_id: `demo-${t}-2`,
  chat_jid: chat,
  sender_jid: sender,
  sender_name: "أحمد",
  timestamp: t - 40000,
  type: "text",
  text: "ضلفة سلك بلسي أبيض 120 في 80 عدد 2",
});

saveIncomingMessage({
  wa_id: `demo-${t}-3`,
  chat_jid: chat,
  sender_jid: sender,
  sender_name: "أحمد",
  timestamp: t - 10000,
  type: "text",
  text: "المقاس بالسم ولو ناقص حاجة قولي",
});

const result = await analyzeCluster(first.cluster_id);
console.log(JSON.stringify({ cluster_id: first.cluster_id, extracted: result.extracted, customers: [mahmoud.name, sameh.name] }, null, 2));
