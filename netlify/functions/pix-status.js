const MANGOFY_API_BASE = "https://checkout.mangofy.com.br";

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value) return "pending";
  if (["paid", "approved", "authorized", "closed"].includes(value)) return "paid";
  if (["pending", "waiting", "waiting_payment", "in_process", "processing"].includes(value)) return "pending";
  if (["refused", "canceled", "cancelled", "expired", "gateway_error", "system_error", "failed"].includes(value)) return "failed";
  return value;
}

function getCredentials() {
  return {
    apiKey: String(
      process.env.MANGOFY_API_KEY ||
      process.env.MANGOFY_API_TOKEN ||
      process.env.API_KEY ||
      ""
    ).trim(),
    storeCode: String(
      process.env.MANGOFY_STORE_CODE ||
      process.env.STORE_CODE ||
      ""
    ).trim(),
  };
}

function buildHeaderVariants() {
  const { apiKey, storeCode } = getCredentials();
  if (!apiKey) {
    throw new Error("MANGOFY_API_KEY nao configurado");
  }

  return [
    {
      Authorization: apiKey,
      "X-API-Key": apiKey,
      "Store-Code": storeCode,
      Accept: "application/json",
    },
    {
      Authorization: apiKey,
      "Store-Code": storeCode,
      Accept: "application/json",
    },
    {
      Authorization: `Bearer ${apiKey}`,
      "Store-Code": storeCode,
      Accept: "application/json",
    },
    {
      Authorization: `Token ${apiKey}`,
      "Store-Code": storeCode,
      Accept: "application/json",
    },
  ];
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
    const paymentCode =
      event.queryStringParameters?.payment_code ||
      event.queryStringParameters?.payment_id ||
      event.queryStringParameters?.hash ||
      "";

    if (!paymentCode) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({ error: "payment_code e obrigatorio" }),
      };
    }

    let response = null;
    let data = {};
    let lastAuthError = null;

    for (const headers of buildHeaderVariants()) {
      response = await fetch(`${MANGOFY_API_BASE}/api/v1/payment/${encodeURIComponent(paymentCode)}`, {
        headers,
      });

      data = await response.json().catch(() => ({}));
      const message = String(data?.message || data?.error || "").toLowerCase();
      const authFailed =
        response.status === 401 ||
        response.status === 403 ||
        message.includes("autoriz") ||
        message.includes("access key") ||
        message.includes("chave de acesso") ||
        message.includes("authorization header");

      if (!authFailed) {
        break;
      }

      lastAuthError = data;
    }

    if (!response || !response.ok) {
      return {
        statusCode: response ? response.status : 500,
        headers: cors,
        body: JSON.stringify({
          error: data?.message || data?.error || "Erro ao consultar a Mangoofy",
          auth_error: lastAuthError || undefined,
          raw: data,
        }),
      };
    }

    const rawStatus = data?.payment_status || data?.status || "";
    const status = normalizeStatus(rawStatus);
    const pixText =
      data?.pix?.pix_qrcode_text ||
      data?.pix?.qrcode_text ||
      data?.pix?.payload ||
      data?.pix_qrcode_text ||
      "";

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        payment_code: paymentCode,
        payment_id: paymentCode,
        transactionId: paymentCode,
        transaction_id: paymentCode,
        status,
        raw_status: rawStatus || null,
        amount: data?.payment_amount ?? null,
        customer: data?.customer || null,
        items: data?.items || null,
        pix: data?.pix || null,
        pix_payload: pixText,
        pix_qrcode: pixText,
        raw: data,
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
