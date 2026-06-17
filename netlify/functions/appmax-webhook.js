function safeJsonParse(text) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return null;
  }
}

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value) return "pending";
  if (["paid", "approved", "authorized", "completed"].includes(value)) return "paid";
  if (["pending", "waiting", "processing", "in_analysis"].includes(value)) return "pending";
  if (["failed", "refused", "canceled", "cancelled", "expired"].includes(value)) return "failed";
  if (["chargeback", "refunded", "refund"].includes(value)) return "chargeback";
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
  const order = body.order || body.data?.order || body.payload?.order || body;
  const payment = body.payment || body.data?.payment || body.payload?.payment || body;

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({
      success: true,
      received: {
        order_id: order?.id || body.order_id || null,
        payment_id: payment?.id || body.payment_id || null,
        status: normalizeStatus(payment?.status || order?.status || body.status),
      },
    }),
  };
};
