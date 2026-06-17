const TICTO_AUTH_URL = "https://glados.ticto.cloud/api/security/oauth/token";
const TICTO_API_BASE = "https://glados.ticto.cloud/api/v1";
const DEFAULT_CHECKOUT_BASE_URL = "https://go.transacaomarketplace.com";

function normalizeCpf(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeAmount(totalAmountCents) {
  const cents = Number(totalAmountCents);
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  return cents > 1000 ? Number((cents / 100).toFixed(2)) : cents;
}

function toBase64Url(text) {
  return Buffer.from(text, "utf8").toString("base64url");
}

function fromBase64Url(text) {
  return Buffer.from(text, "base64url").toString("utf8");
}

function encodePaymentRef(payload) {
  return `ticto.${toBase64Url(JSON.stringify(payload))}`;
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

async function resolveOffer({ token, offerCode, productId }) {
  const normalizedOfferCode = String(offerCode || "").trim();
  if (normalizedOfferCode) {
    return { code: normalizedOfferCode, productId: productId ? String(productId).trim() : "" };
  }

  const normalizedProductId = String(productId || "").trim();
  if (!normalizedProductId) {
    throw new Error("Defina TICTO_OFFER_CODE ou TICTO_PRODUCT_ID");
  }

  const response = await fetch(
    `${TICTO_API_BASE}/offers?product_id=${encodeURIComponent(normalizedProductId)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    }
  );

  const data = await response.json().catch(() => ({}));
  const offers = Array.isArray(data?.data) ? data.data : [];

  if (!response.ok || !offers.length) {
    throw new Error(data?.message || data?.error || "Nao foi possivel localizar a oferta da Ticto");
  }

  const offer = offers.find((item) => item?.is_active !== false) || offers[0];

  if (!offer?.code) {
    throw new Error("Oferta da Ticto sem code valido");
  }

  return {
    code: String(offer.code).trim(),
    productId: String(offer?.product?.id || normalizedProductId || "").trim(),
  };
}

function buildCheckoutUrl(offerCode) {
  const baseUrl = String(process.env.TICTO_CHECKOUT_BASE_URL || DEFAULT_CHECKOUT_BASE_URL).replace(/\/$/, "");
  return `${baseUrl}/${encodeURIComponent(offerCode)}`;
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

  try {
    const body = JSON.parse(event.body || "{}");
    const vehicle = body.vehicle || {};
    const pricing = body.pricing || {};
    const shipping = body.shipping || {};
    const customer = body.customer || {};
    const tracking = body.tracking || {};

    const amountCents = Number(pricing.totalAmountCents ?? pricing.totalAmount ?? body.amount ?? 0) || 0;
    const totalAmount = normalizeAmount(amountCents);

    if (!totalAmount || !customer.name || !customer.email || !customer.cpf) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({
          error: "Faltam dados: totalAmount, customer.name, customer.email, customer.cpf",
        }),
      };
    }

    const offerCodeEnv = String(process.env.TICTO_OFFER_CODE || "").trim();
    const productIdEnv = String(process.env.TICTO_PRODUCT_ID || "").trim();
    let offer = null;

    if (offerCodeEnv) {
      offer = {
        code: offerCodeEnv,
        productId: productIdEnv,
      };
    } else {
      const token = await getTictoAccessToken();
      offer = await resolveOffer({
        token,
        offerCode: offerCodeEnv,
        productId: productIdEnv,
      });
    }

    const checkoutUrl = buildCheckoutUrl(offer.code);
    const paymentRef = encodePaymentRef({
      provider: "ticto",
      offerCode: offer.code,
      productId: offer.productId || String(process.env.TICTO_PRODUCT_ID || ""),
      checkoutUrl,
      customer: {
        name: String(customer.name || "").trim(),
        email: String(customer.email || "").trim(),
        cpf: normalizeCpf(customer.cpf),
        phone: normalizePhone(customer.phone || customer.phone_number || ""),
      },
      shipping: {
        zipCode: String(shipping?.address?.zipCode || "").trim(),
      },
      vehicle: {
        type: vehicle.type || "",
        brand: vehicle.brand || "",
        model: vehicle.model || "",
        year: vehicle.year || "",
      },
      pricing: {
        totalAmountCents: Number(pricing.totalAmountCents ?? pricing.totalAmount ?? body.amount ?? 0) || 0,
      },
      tracking: {
        utmSource: tracking.utmSource || "",
        utmMedium: tracking.utmMedium || "",
        utmCampaign: tracking.utmCampaign || "",
        utmTerm: tracking.utmTerm || "",
        utmContent: tracking.utmContent || "",
      },
      createdAt: Date.now(),
    });

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        transactionId: paymentRef,
        transaction_id: paymentRef,
        payment_id: paymentRef,
        status: "pending",
        raw_status: "checkout_link",
        amount: amountCents,
        total_amount: totalAmount,
        checkout_url: checkoutUrl,
        pix_payload: checkoutUrl,
        pix_qrcode: checkoutUrl,
        pix: {
          payload: checkoutUrl,
          qrcode: checkoutUrl,
          qrCode: checkoutUrl,
        },
        offer: {
          code: offer.code,
          productId: offer.productId || null,
        },
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

exports._decodePaymentRef = decodePaymentRef;
