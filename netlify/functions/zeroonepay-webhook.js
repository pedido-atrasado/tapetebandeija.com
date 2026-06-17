function safeJsonParse(text) {
  try {
    return JSON.parse(text || "{}");
  } catch (_) {
    return null;
  }
}

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value) return "pending";
  if (["paid", "authorized", "approved"].includes(value)) return "paid";
  if (["waiting payment", "waiting_payment", "pending", "waiting"].includes(value)) return "pending";
  if (["failed", "refused", "canceled", "cancelled"].includes(value)) return "failed";
  if (["chargeback", "refund", "refunded"].includes(value)) return "chargeback";
  return value;
}

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: cors,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  const body = safeJsonParse(event.body) || {};
  const payload = body.data || body.transaction || body.payment || body;
  const status = normalizeStatus(payload.status || body.status);
  const hash = String(payload.hash || payload.transaction_hash || payload.payment_id || body.hash || body.transactionId || "").trim();

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({
      success: true,
      received: {
        hash: hash || null,
        status,
        raw_status: payload.status || body.status || null,
      },
    }),
  };
};
