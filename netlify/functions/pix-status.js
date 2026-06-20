const DEFAULT_SITE_URL = "https://tapetebandeja.netlify.app";

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value) return "pending";
  if (["paid", "approved", "authorized", "closed"].includes(value)) return "paid";
  if (["pending", "waiting", "waiting_payment", "in_process", "processing", "success"].includes(value)) return "pending";
  if (["refused", "canceled", "cancelled", "expired", "gateway_error", "system_error", "failed"].includes(value)) return "failed";
  return value;
}

function getCheckoutBaseUrl() {
  const baseUrl = String(
    process.env.VEGA_CHECKOUT_BASE_URL ||
    process.env.VEGA_API_BASE_URL ||
    process.env.VEGA_BASE_URL ||
    ""
  ).trim().replace(/\/$/, "");

  return baseUrl || "https://checkout.vegacheckout.com.br";
}

function getApiKey() {
  return String(
    process.env.VEGA_API_KEY ||
    process.env.VEGA_CLIENT_SECRET ||
    process.env.CLIENT_SECRET ||
    process.env.VEGA_API_TOKEN ||
    process.env.PAYMENTS_API_KEY ||
    process.env.API_KEY ||
    process.env.SUNIZE_API_KEY ||
    ""
  ).trim();
}

function getDomainHeader() {
  const explicit = String(
    process.env.VEGA_DOMAIN ||
    process.env.VEGA_CHECKOUT_DOMAIN ||
    process.env.PAYMENTS_DOMAIN ||
    ""
  ).trim();
  if (explicit) {
    return explicit.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  }

  const baseUrl = getCheckoutBaseUrl();
  if (baseUrl) {
    try {
      return new URL(baseUrl).hostname;
    } catch {
      // ignore
    }
  }

  try {
    return new URL(String(process.env.SITE_URL || process.env.ALLOWED_ORIGIN || DEFAULT_SITE_URL)).hostname;
  } catch {
    return "";
  }
}

function buildHeaders() {
  const apiKey = getApiKey();
  const domain = getDomainHeader();

  if (!apiKey || !domain) return null;

  return {
    "api-key": apiKey,
    "x-domain": domain,
    Accept: "application/json",
  };
}

function extractStatusPayload(data) {
  const root = data?.data || data || {};
  const rawStatus = root?.payment_status || root?.status || data?.payment_status || data?.status || "pending";
  const pixText =
    root?.pix_copy_paste ||
    root?.pix_qrcode_text ||
    root?.pix_qrcode ||
    root?.pix?.pix_copy_paste ||
    root?.pix?.pix_qrcode_text ||
    root?.pix?.qrcode ||
    data?.pix_copy_paste ||
    "";

  const pixImage =
    root?.pix_code_image64 ||
    root?.pix_qrcode_image64 ||
    root?.pix_qrcode_image ||
    root?.pix?.pix_code_image64 ||
    root?.pix?.pix_qrcode_image ||
    data?.pix_code_image64 ||
    "";

  return { rawStatus, pixText, pixImage, root };
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

  const paymentCode =
    event.queryStringParameters?.payment_code ||
    event.queryStringParameters?.payment_id ||
    event.queryStringParameters?.hash ||
    "";

  if (!paymentCode) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: "payment_code e obrigatorio", status: "pending" }),
    };
  }

  try {
    const checkoutBaseUrl = getCheckoutBaseUrl();
    const headers = buildHeaders();

    if (checkoutBaseUrl && headers) {
      const candidates = [
        `${checkoutBaseUrl}/api/checkout/${encodeURIComponent(paymentCode)}`,
        `${checkoutBaseUrl}/api/checkout?transaction_token=${encodeURIComponent(paymentCode)}`,
        `${checkoutBaseUrl}/api/checkout?payment_code=${encodeURIComponent(paymentCode)}`,
      ];

      for (const url of candidates) {
        try {
          const response = await fetch(url, { headers });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            continue;
          }

          const extracted = extractStatusPayload(data);
          return {
            statusCode: 200,
            headers: cors,
            body: JSON.stringify({
              payment_code: paymentCode,
              payment_id: paymentCode,
              transactionId: paymentCode,
              transaction_id: paymentCode,
              status: normalizeStatus(extracted.rawStatus),
              raw_status: extracted.rawStatus,
              amount: extracted.root?.payment_value ?? extracted.root?.amount ?? null,
              customer: extracted.root?.customer || null,
              items: extracted.root?.products || extracted.root?.items || null,
              pix: extracted.root?.pix || null,
              pix_payload: extracted.pixText,
              pix_qrcode: extracted.pixText,
              pix_qrcode_image: extracted.pixImage,
              raw: data,
            }),
          };
        } catch {
          // try next candidate
        }
      }
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        payment_code: paymentCode,
        payment_id: paymentCode,
        transactionId: paymentCode,
        transaction_id: paymentCode,
        status: "pending",
        raw_status: "pending",
        amount: null,
        customer: null,
        items: null,
        pix: null,
        pix_payload: "",
        pix_qrcode: "",
        pix_qrcode_image: "",
        raw: null,
      }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        payment_code: paymentCode,
        payment_id: paymentCode,
        transactionId: paymentCode,
        transaction_id: paymentCode,
        status: "pending",
        raw_status: "pending",
        error: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
