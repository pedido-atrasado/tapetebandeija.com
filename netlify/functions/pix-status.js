const TICTO_API_BASE = "https://glados.ticto.cloud/api/v1";
const TICTO_AUTH_URL = "https://glados.ticto.cloud/api/security/oauth/token";

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value) return "pending";
  if (["paid", "authorized", "approved", "closed"].includes(value)) return "paid";
  if (["waiting payment", "waiting_payment", "pending", "waiting", "processing"].includes(value)) return "pending";
  if (["failed", "refused", "canceled", "cancelled", "aborted", "error", "expired"].includes(value)) return "failed";
  if (["chargeback", "refund", "refunded"].includes(value)) return "chargeback";
  if (value === "in_dispute" || value === "disputed" || value === "claimed") return "dispute";
  return value;
}

function fromBase64Url(text) {
  return Buffer.from(text, "base64url").toString("utf8");
}

function decodePaymentRef(paymentId) {
  const raw = String(paymentId || "");
  if (!raw.startsWith("ticto.")) return null;

  try {
    const decoded = fromBase64Url(raw.slice("ticto.".length));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function parseTictoDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, day, month, year, hour, minute, second] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

async function getTictoAccessToken() {
  const clientId = String(process.env.TICTO_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.TICTO_CLIENT_SECRET || "").trim();

  if (!clientId || !clientSecret) {
    throw new Error("TICTO_CLIENT_ID ou TICTO_CLIENT_SECRET nao configurado");
  }

  const response = await fetch(TICTO_AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "*",
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.access_token) {
    throw new Error(data?.message || data?.error || "Falha ao autenticar na Ticto");
  }

  return data.access_token;
}

function pickLatestMatch(rows, decoded) {
  const normalizedEmail = String(decoded?.customer?.email || "").trim().toLowerCase();
  const normalizedCpf = String(decoded?.customer?.cpf || "").replace(/\D/g, "");
  const normalizedName = String(decoded?.customer?.name || "").trim().toLowerCase();
  const normalizedProductId = String(decoded?.productId || "").trim();
  const offerCode = String(decoded?.offerCode || "").trim().toLowerCase();

  const createdAtThreshold = Number(decoded?.createdAt || 0) - 2 * 60 * 1000;

  const matches = (rows || []).filter((row) => {
    const customer = row?.customer || {};
    const product = row?.product || {};
    const offer = row?.offer || {};
    const rowEmail = String(customer.email || "").trim().toLowerCase();
    const rowCpf = String(customer.cpf || "").replace(/\D/g, "");
    const rowName = String(customer.name || "").trim().toLowerCase();
    const rowProductId = String(product.id || "").trim();
    const rowOfferCode = String(offer.code || "").trim().toLowerCase();

    const emailMatch = !normalizedEmail || rowEmail === normalizedEmail;
    const cpfMatch = !normalizedCpf || rowCpf === normalizedCpf;
    const nameMatch = !normalizedName || rowName.includes(normalizedName) || normalizedName.includes(rowName);
    const productMatch = !normalizedProductId || rowProductId === normalizedProductId;
    const offerMatch = !offerCode || rowOfferCode === offerCode;
    const rowCreatedAt = parseTictoDate(row?.created_at)?.getTime() || 0;
    const createdAtMatch = !createdAtThreshold || rowCreatedAt >= createdAtThreshold;

    return emailMatch && cpfMatch && nameMatch && productMatch && offerMatch && createdAtMatch && String(row?.transaction?.payment_method || "").toLowerCase() === "pix";
  });

  return matches[0] || null;
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

    const decoded = decodePaymentRef(paymentId);
    if (!decoded) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({ error: "payment_id invalido para Ticto" }),
      };
    }

    const accessToken = await getTictoAccessToken();
    const query = new URLSearchParams({
      page: "1",
      "filter[transactionPaymentMethod]": "pix",
      "filter[customerNameOrEmail]": decoded.customer?.email || decoded.customer?.name || "",
      "filter[customerDocument]": decoded.customer?.cpf || "",
    });

    const response = await fetch(`${TICTO_API_BASE}/orders/history?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    const data = await response.json().catch(() => ({}));
    const rows = Array.isArray(data?.data) ? data.data : [];
    const match = pickLatestMatch(rows, decoded);

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: cors,
        body: JSON.stringify({
          error: data?.message || data?.error || "Erro ao consultar a Ticto",
        }),
      };
    }

    if (!match) {
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          payment_id: paymentId,
          transactionId: paymentId,
          transaction_id: paymentId,
          status: "pending",
          raw_status: "not_found",
          amount: null,
        }),
      };
    }

    const rawStatus = match?.transaction?.status || match?.order_item?.status || "";
    const normalizedStatus = normalizeStatus(rawStatus);
    const amount = match?.transaction?.paid_amount ?? match?.order_item?.amount ?? match?.offer?.price ?? null;
    const transactionId = String(match?.transaction?.hash || match?.order?.hash || paymentId);

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        payment_id: paymentId,
        transactionId,
        transaction_id: transactionId,
        status: normalizedStatus,
        raw_status: rawStatus || null,
        amount,
        customer: match?.customer || null,
        order: match?.order || null,
        offer: match?.offer || null,
        product: match?.product || null,
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
