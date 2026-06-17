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
  if (["paid", "authorized", "approved", "closed"].includes(value)) return "paid";
  if (["waiting payment", "waiting_payment", "pending", "waiting", "processing"].includes(value)) return "pending";
  if (["failed", "refused", "canceled", "cancelled", "aborted", "error", "expired"].includes(value)) return "failed";
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
  const transaction = body.transaction || body.data || body.payment || body;

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({
      success: true,
      received: {
        transaction_hash: transaction.transaction_hash || transaction.hash || null,
        status: normalizeStatus(transaction.status || body.status),
        payment_method: transaction.payment_method || body.payment_method || null,
        amount: transaction.amount ?? body.amount ?? null,
        paid_at: transaction.paid_at || body.paid_at || null,
      },
    }),
  };
};
