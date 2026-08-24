import fs from "node:fs";
import path from "node:path";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import pino from "pino";
import { db, getSetting, setSetting } from "./db.js";
import { saveIncomingMessage, scheduleAnalyze } from "./engine.js";
import { AUTH_DIR, MEDIA_DIR, uid } from "./utils.js";

let sock = null;
let ioRef = null;
const state = {
  status: "disconnected",
  qr: null,
  user: null,
  groups: [],
  lastError: "",
};

export function getWaState() {
  const selectedJid = getSetting("selected_group_jid", "");
  const selectedName = getSetting("selected_group_name", "");
  return { ...state, selectedJid, selectedName };
}

export function setSocketServer(io) {
  ioRef = io;
}

function emitStatus() {
  ioRef?.emit("wa_status", getWaState());
}

function unwrap(message) {
  if (!message) return {};
  return (
    message.ephemeralMessage?.message ||
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.viewOnceMessageV2Extension?.message ||
    message.documentWithCaptionMessage?.message ||
    message
  );
}

function extractContent(waMsg) {
  const inner = unwrap(waMsg.message);
  const quoted =
    inner.extendedTextMessage?.contextInfo?.stanzaId ||
    inner.imageMessage?.contextInfo?.stanzaId ||
    inner.audioMessage?.contextInfo?.stanzaId ||
    inner.videoMessage?.contextInfo?.stanzaId ||
    inner.documentMessage?.contextInfo?.stanzaId ||
    "";

  if (inner.conversation) {
    return { type: "text", text: inner.conversation, quoted };
  }
  if (inner.extendedTextMessage?.text) {
    return { type: "text", text: inner.extendedTextMessage.text, quoted };
  }
  if (inner.imageMessage) {
    return {
      type: "image",
      text: inner.imageMessage.caption || "",
      quoted,
      media: inner.imageMessage,
      mime: inner.imageMessage.mimetype || "image/jpeg",
      ext: "jpg",
    };
  }
  if (inner.audioMessage) {
    return {
      type: "audio",
      text: "",
      quoted,
      media: inner.audioMessage,
      mime: inner.audioMessage.mimetype || "audio/ogg",
      ext: "ogg",
    };
  }
  if (inner.videoMessage) {
    return {
      type: "video",
      text: inner.videoMessage.caption || "",
      quoted,
      media: inner.videoMessage,
      mime: inner.videoMessage.mimetype || "video/mp4",
      ext: "mp4",
    };
  }
  if (inner.documentMessage) {
    return {
      type: "document",
      text: inner.documentMessage.caption || inner.documentMessage.fileName || "",
      quoted,
      media: inner.documentMessage,
      mime: inner.documentMessage.mimetype || "application/octet-stream",
      ext: path.extname(inner.documentMessage.fileName || "") || ".bin",
    };
  }
  return { type: "other", text: "", quoted };
}

async function saveMedia(waMsg, content) {
  if (!content.media) return { media_path: "", mime_type: content.mime || "" };
  try {
    const buffer = await downloadMediaMessage(waMsg, "buffer", {}, { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage });
    const name = `${Date.now()}-${uid().slice(0, 8)}.${String(content.ext || "bin").replace(".", "")}`;
    const abs = path.join(MEDIA_DIR, name);
    fs.writeFileSync(abs, buffer);
    return { media_path: abs, mime_type: content.mime || "" };
  } catch (err) {
    console.error("media download failed", err);
    return { media_path: "", mime_type: content.mime || "" };
  }
}

async function refreshGroups() {
  if (!sock) return [];
  try {
    const participating = await sock.groupFetchAllParticipating();
    state.groups = Object.values(participating).map((g) => ({
      jid: g.id,
      name: g.subject,
      size: g.participants?.length || 0,
    }));
  } catch (err) {
    state.lastError = String(err.message || err);
  }
  emitStatus();
  return state.groups;
}

export async function startWhatsApp() {
  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({
    version,
    auth: authState,
    printQRInTerminal: false,
    browser: Browsers.windows("Chrome"),
    logger: pino({ level: "silent" }),
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      state.status = "qr";
      state.qr = await QRCode.toDataURL(qr);
      emitStatus();
    }
    if (connection === "connecting") {
      state.status = "connecting";
      emitStatus();
    }
    if (connection === "open") {
      state.status = "connected";
      state.qr = null;
      state.user = sock.user || null;
      state.lastError = "";
      await refreshGroups();
      emitStatus();
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      state.status = "disconnected";
      state.qr = null;
      state.user = null;
      state.lastError = loggedOut ? "تم تسجيل الخروج. امسح QR من جديد." : "انقطع الاتصال. جاري إعادة المحاولة.";
      emitStatus();
      if (loggedOut) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      }
      setTimeout(() => {
        startWhatsApp().catch((err) => console.error(err));
      }, loggedOut ? 1000 : 4000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type === "prepend") return;
    const selected = getSetting("selected_group_jid", "");
    console.log("WA upsert", type, "count", messages?.length, "selected", selected || "(none)");
    if (!selected) return;
    for (const waMsg of messages) {
      try {
        const remote = waMsg.key?.remoteJid || "";
        if (!waMsg?.message) {
          console.log("WA skip empty body", remote, waMsg.key?.id);
          continue;
        }
        if (remote !== selected) {
          console.log("WA skip other chat", remote);
          continue;
        }
        if (waMsg.message.protocolMessage || waMsg.message.reactionMessage) continue;
        const content = extractContent(waMsg);
        console.log("WA incoming", content.type, (content.text || "").slice(0, 80));
        if (content.type === "other" && !content.text) continue;
        const media = await saveMedia(waMsg, content);
        const saved = saveIncomingMessage({
          wa_id: waMsg.key.id,
          chat_jid: remote,
          sender_jid: waMsg.key.participant || waMsg.key.participantAlt || remote,
          sender_name: waMsg.pushName || (waMsg.key.fromMe ? "أنت" : ""),
          timestamp: Number(waMsg.messageTimestamp || 0) * 1000,
          type: content.type,
          text: content.text,
          quoted_wa_id: content.quoted,
          media_path: media.media_path,
          mime_type: media.mime_type,
          from_me: waMsg.key.fromMe ? 1 : 0,
        });
        scheduleAnalyze(saved.cluster_id, (event, payload) => ioRef?.emit(event, payload));
        ioRef?.emit("message", saved);
      } catch (err) {
        console.error("incoming message failed", err);
      }
    }
  });
}

export async function logoutWhatsApp() {
  try {
    await sock?.logout();
  } catch {
    // ignore
  }
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  state.status = "disconnected";
  state.qr = null;
  state.user = null;
  emitStatus();
}

export async function selectGroup(jid) {
  const group = state.groups.find((g) => g.jid === jid);
  setSetting("selected_group_jid", jid || "");
  setSetting("selected_group_name", group?.name || "");
  emitStatus();
  return getWaState();
}

export async function reactLikeToMessages(messages = []) {
  if (!sock || state.status !== "connected") {
    console.log("WA react skipped: not connected");
    return { ok: false, reacted: 0 };
  }
  let reacted = 0;
  for (const msg of messages) {
    if (!msg?.wa_id || !msg.chat_jid) continue;
    if (String(msg.wa_id).startsWith("demo-")) continue;
    if (Number(msg.reacted) === 1) continue;
    const fromMe = Number(msg.from_me) === 1 || msg.sender_jid === msg.chat_jid;
    const key = {
      remoteJid: msg.chat_jid,
      id: msg.wa_id,
      fromMe,
    };
    if (!fromMe && msg.sender_jid && msg.sender_jid !== msg.chat_jid) {
      key.participant = msg.sender_jid;
    }
    try {
      await sock.sendMessage(msg.chat_jid, {
        react: { text: "👍", key },
      });
      db.prepare("UPDATE messages SET reacted = 1 WHERE id = ?").run(msg.id);
      reacted += 1;
      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      console.error("WA react failed", msg.wa_id, err?.message || err);
    }
  }
  return { ok: true, reacted };
}

export { refreshGroups };
