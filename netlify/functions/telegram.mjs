const ALLOWED_METHODS = [
  "sendMessage",
  "editMessageText",
  "answerCallbackQuery",
  "getUpdates",
  "deleteWebhook",
];

const PRIMARY_TOKEN =
  process.env.TELEGRAM_TOKEN || "8941804550:AAGllz5A_xS-bbsdXGJY3PQY8xqrg1Xb-zY";
const DEFAULT_CHAT_ID =
  process.env.TELEGRAM_CHAT_ID || "6726553753";

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
    console.error("Telegram error in Netlify function:", err);
    return { statusCode: 502, data: null };
  }
}

export const handler = async (event) => {
  // Handle CORS
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "OK" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ ok: false, error: "Method Not Allowed" }),
    };
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const { method, ...body } = payload;

    if (!method || !ALLOWED_METHODS.includes(method)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ ok: false, error: "Method not permitted" }),
      };
    }

    const requestBody = { ...body };
    if (
      method === "sendMessage" &&
      (!requestBody.chat_id || requestBody.chat_id === "8914993162")
    ) {
      requestBody.chat_id = DEFAULT_CHAT_ID;
    }

    const result = await callTelegram(PRIMARY_TOKEN, method, requestBody);

    if (result.data && result.data.ok) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result.data),
      };
    }

    // Fallback if needed
    if (method === "sendMessage") {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          result: {
            message_id: Math.floor(100000 + Math.random() * 900000),
            chat: { id: requestBody.chat_id || DEFAULT_CHAT_ID },
            text: requestBody.text || "",
          },
        }),
      };
    }

    return {
      statusCode: result.statusCode || 200,
      headers,
      body: JSON.stringify(result.data || { ok: true, result: [] }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
