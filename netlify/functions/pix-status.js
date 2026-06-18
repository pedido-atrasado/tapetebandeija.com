const RISEPAY_API_BASE = "https://api.risepay.com.br";

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value) return "pending";
  if (["paid", "approved", "authorized", "closed"].includes(value)) return "paid";
  if (["waiting payment", "waiting_payment", "pending", "in_process", "processing", "waiting"].includes(value)) return "pending";
  if (["refused", "canceled", "cancelled", "expired", "chargeback", "gateway_error", "system_error", "refunded", "underpaid", "overpaid"].includes(value)) return "failed";
  return value;
}

function getPrivateToken() {
  return String(
    process.env.RISEPAY_PRIVATE_TOKEN ||
    process.env.RISEPAY_API_PRIVATE_TOKEN ||
    process.env.RISEPAY_TOKEN_PRIVATE ||
    process.env.MANGOFY_API_KEY ||
    process.env.MANGOFY_API_TOKEN ||
    process.env.API_KEY ||
    ""
  ).trim();
}

function extractPixText(data) {
  return (
    data?.object?.pix?.qrCode ||
    data?.pix?.qrCode ||
    data?.pix?.pix_qrcode_text ||
    data?.pix?.qrcode ||
    data?.pix_qrcode_text ||
    data?.pix_qrcode ||
    ""
  );
}

function extractPixImage(data) {
  return (
    data?.object?.pix?.image ||
    data?.pix?.image ||
    data?.pix_code_image64 ||
    data?.pix_qrcode_image64 ||
    data?.pix_qrcode_image ||
    ""
  );
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

  const paymentId =
    event.queryStringParameters?.payment_id ||
    event.queryStringParameters?.payment_code ||
    event.queryStringParameters?.transaction_id ||
    event.queryStringParameters?.hash ||
    "";

  if (!paymentId) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: "payment_id e obrigatorio", status: "pending" }),
    };
  }

  try {
    const privateToken = getPrivateToken();
    if (!privateToken) {
      throw new Error("RISEPAY_PRIVATE_TOKEN nao configurado");
    }

    const response = await fetch(`${RISEPAY_API_BASE}/api/External/Transactions/${encodeURIComponent(paymentId)}`, {
      headers: {
        Authorization: privateToken,
        Accept: "application/json",
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: cors,
        body: JSON.stringify({
          error: data?.message || data?.error || "Erro ao consultar a RisePay",
          raw: data,
        }),
      };
    }

    const object = data?.object || data || {};
    const rawStatus = object?.status || data?.status || "Waiting Payment";
    const pixText = extractPixText(data);
    const pixImage = extractPixImage(data);

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        payment_code: paymentId,
        payment_id: paymentId,
        transactionId: paymentId,
        transaction_id: paymentId,
        status: normalizeStatus(rawStatus),
        raw_status: rawStatus,
        amount: object?.amount ?? null,
        customer: object?.customer || null,
        items: object?.items || null,
        pix: object?.pix || null,
        pix_payload: pixText,
        pix_qrcode: pixText,
        pix_qrcode_image: pixImage,
        raw: data,
      }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        payment_code: paymentId,
        payment_id: paymentId,
        transactionId: paymentId,
        transaction_id: paymentId,
        status: "pending",
        raw_status: "pending",
        error: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
