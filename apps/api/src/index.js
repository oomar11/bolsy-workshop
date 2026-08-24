import http from "node:http";
import { Server } from "socket.io";
import { createApp } from "./http.js";
import { getWaState, setSocketServer, startWhatsApp } from "./whatsapp.js";
import "./db.js";

const PORT = Number(process.env.PORT || 4000);
const server = http.createServer();
const io = new Server(server, {
  cors: { origin: true },
});
const app = createApp(io);
server.on("request", app);
setSocketServer(io);

io.on("connection", (socket) => {
  socket.emit("wa_status", getWaState());
});

server.listen(PORT, () => {
  console.log(`API running on http://127.0.0.1:${PORT}`);
  startWhatsApp().catch((err) => console.error("whatsapp start failed", err));
});

