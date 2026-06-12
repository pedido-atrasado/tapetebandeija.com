function normalizeStatus(status) {
  if (status === "AUTHORIZED") return "paid";
  if (status === "PENDING") return "pending";
  if (status === "FAILED") return "failed";
  if (status === "CHARGEBACK") return "chargeback";
  if (status === "IN_DISPUTE") return "dispute";
  return String(status || "").toLowerCase() || "pending";
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
    const paymentId = event.queryStringParameters?.payment_id || "";
    if (!paymentId) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({ error: "payment_id e obrigatorio" }),
      };
    }

    const apiKey = process.env.SUNIZE_API_KEY;
    const apiSecret = process.env.SUNIZE_API_SECRET;
    if (!apiKey || !apiSecret) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({ error: "SUNIZE_API_KEY ou SUNIZE_API_SECRET nao configurada" }),
      };
    }

    const baseUrl = (process.env.SUNIZE_BASE_URL || "https://api.sunize.com.br/v1").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/transactions/${encodeURIComponent(paymentId)}`, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "x-api-secret": apiSecret,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json().catch(() => ({}));

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
        payment_id: data?.id || paymentId,
        status: normalizeStatus(data?.status),
        amount: data?.total_value ?? data?.amount ?? null,
        raw_status: data?.status || null,
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
