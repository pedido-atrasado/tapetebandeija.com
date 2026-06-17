function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value) return "pending";
  if (["paid", "authorized", "approved"].includes(value)) return "paid";
  if (["waiting payment", "waiting_payment", "pending", "waiting"].includes(value)) return "pending";
  if (["failed", "refused", "canceled", "cancelled"].includes(value)) return "failed";
  if (["chargeback", "refund", "refunded"].includes(value)) return "chargeback";
  if (value === "in_dispute") return "dispute";
  return value;
}

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: cors,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  try {
    const paymentId = event.queryStringParameters?.payment_id || event.queryStringParameters?.hash || "";
    if (!paymentId) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({ error: "payment_id e obrigatorio" }),
      };
    }

    const apiToken = process.env.ZEROONEPAY_API_TOKEN || process.env.ZEROONEPAY_TOKEN || "";
    if (!apiToken) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({ error: "ZEROONEPAY_API_TOKEN nao configurado" }),
      };
    }

    const baseUrl = (process.env.ZEROONEPAY_BASE_URL || "https://api.zeroonepay.com.br/api/public/v1").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/transactions/${encodeURIComponent(paymentId)}?api_token=${encodeURIComponent(apiToken)}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const data = await response.json().catch(() => ({}));
    const object = data?.object || data;

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: cors,
        body: JSON.stringify({
          error: data.message || data.error || "Erro ao consultar transacao PIX",
        }),
      };
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        payment_id: String(object?.hash || object?.identifier || object?.id || paymentId),
        transactionId: String(object?.hash || object?.identifier || object?.id || paymentId),
        transaction_id: String(object?.hash || object?.identifier || object?.id || paymentId),
        status: normalizeStatus(object?.status || data?.status),
        amount: object?.amount ?? data?.amount ?? null,
        raw_status: object?.status || data?.status || null,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
    };
  }
};
