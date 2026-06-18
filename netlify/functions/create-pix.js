const MANGOFY_API_BASE = "https://checkout.mangofy.com.br";
const DEFAULT_POSTBACK_PATH = "/api/mangofy/webhook";

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhoneForGateway(value) {
  let digits = normalizeDigits(value);
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function centsToReais(cents) {
  return Number((Number(cents) / 100).toFixed(2));
}

function makeExternalCode() {
  return `tapete-bandeja-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getSiteBaseUrl() {
  return (
    String(process.env.SITE_URL || "").trim() ||
    String(process.env.ALLOWED_ORIGIN || "").trim() ||
    "https://tapetebandeja.netlify.app"
  ).replace(/\/$/, "");
}

function getPostbackUrl() {
  return `${getSiteBaseUrl()}${DEFAULT_POSTBACK_PATH}`;
}

function getCredentials() {
  const apiKey = String(
    process.env.MANGOFY_API_KEY ||
    process.env.MANGOFY_API_TOKEN ||
    process.env.API_KEY ||
    ""
  ).trim();

  const storeCode = String(
    process.env.MANGOFY_STORE_CODE ||
    process.env.STORE_CODE ||
    ""
  ).trim();

  return { apiKey, storeCode };
}

function buildHeaderVariants() {
  const { apiKey, storeCode } = getCredentials();

  if (!apiKey) {
    throw new Error("MANGOFY_API_KEY nao configurado");
  }

  const variants = [
    {
      Authorization: apiKey,
    },
    {
      Authorization: `Bearer ${apiKey}`,
    },
    {
      Authorization: `Token ${apiKey}`,
    },
    {
      Authorization: apiKey,
      "Store-Code": storeCode,
    },
    {
      Authorization: `Bearer ${apiKey}`,
      "Store-Code": storeCode,
    },
    {
      Authorization: `Token ${apiKey}`,
      "Store-Code": storeCode,
    },
  ];

  return variants.map((headers) => ({
    ...headers,
    "Content-Type": "application/json",
    Accept: "application/json",
  }));
}

function buildHeaders() {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function normalizeResponseStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value) return "pending";
  if (["paid", "approved", "authorized", "closed"].includes(value)) return "paid";
  if (["pending", "waiting", "waiting_payment", "in_process", "processing"].includes(value)) return "pending";
  if (["refused", "canceled", "cancelled", "expired", "gateway_error", "system_error", "failed"].includes(value)) return "failed";
  return value;
}

function extractPixText(data) {
  return (
    data?.pix?.pix_qrcode_text ||
    data?.pix?.qrcode_text ||
    data?.pix?.pix_qrcode ||
    data?.pix?.payload ||
    data?.pix_qrcode_text ||
    data?.pix_qrcode ||
    data?.payment?.pix?.pix_qrcode_text ||
    ""
  );
}

function extractPixImage(data) {
  return (
    data?.pix?.pix_qrcode_image ||
    data?.pix?.qrcode_image ||
    data?.pix?.qrcode ||
    data?.pix_qrcode_image ||
    ""
  );
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

    const totalAmountCents = Number(pricing.totalAmountCents ?? pricing.totalAmount ?? body.amount ?? 0) || 0;
    const kitAmountCents = Number(pricing.kitAmountCents ?? 0) || Math.max(totalAmountCents - Number(pricing.shippingAmountCents ?? 0), 0);
    const shippingAmountCents = Number(pricing.shippingAmountCents ?? 0) || 0;

    if (totalAmountCents < 500) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({ error: "Valor minimo para Pix e R$ 5,00" }),
      };
    }

    if (!customer.name || !customer.email || !customer.cpf) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({
          error: "Faltam dados: customer.name, customer.email, customer.cpf",
        }),
      };
    }

    const externalCode = makeExternalCode();
    const payload = {
      external_code: externalCode,
      payment_format: "regular",
      payment_method: "pix",
      installments: 1,
      payment_amount: totalAmountCents,
      shipping_amount: shippingAmountCents,
      postback_url: getPostbackUrl(),
      items: [
        {
          code: "tapete-bandeja",
          name: `Tapete Bandeja ${vehicle.brand || ""} ${vehicle.model || ""}`.trim(),
          quantity: 1,
          price: kitAmountCents || totalAmountCents,
          photo: "",
          description: "Tapete Bandeja 3D",
          digital_flag: false,
        },
      ],
      customer: {
        email: String(customer.email || "").trim(),
        name: String(customer.name || "").trim(),
        document: normalizeDigits(customer.cpf),
        phone: normalizePhoneForGateway(customer.phone || customer.phone_number || ""),
        ip:
          String(event.headers?.["x-forwarded-for"] || event.headers?.["X-Forwarded-For"] || "").split(",")[0].trim() ||
          String(event.headers?.["client-ip"] || event.headers?.["Client-IP"] || "").trim() ||
          "127.0.0.1",
      },
      pix: {
        expires_in_days: 1,
      },
      extra: {
        metadata: {
          utm_source: tracking.utmSource || "",
          utm_medium: tracking.utmMedium || "",
          utm_campaign: tracking.utmCampaign || "",
          utm_term: tracking.utmTerm || "",
          utm_content: tracking.utmContent || "",
          page_url: tracking.pageUrl || "",
          pedido_origem: "checkout-api",
          vehicle_type: vehicle.type || "",
          brand: vehicle.brand || "",
          model: vehicle.model || "",
          year: vehicle.year || "",
          color: vehicle.color || "",
          kit: vehicle.kit || "",
        },
      },
    };

    let response = null;
    let data = {};
    let lastAuthError = null;

    for (const headers of buildHeaderVariants()) {
      response = await fetch(`${MANGOFY_API_BASE}/api/v1/payment`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
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
          error:
            data?.message ||
            data?.error ||
            data?.errors?.[0]?.message ||
            "Nao foi possivel gerar o Pix na Mangoofy",
          auth_error: lastAuthError || undefined,
          raw: data,
        }),
      };
    }

    const paymentCode = String(
      data?.payment_code ||
      data?.payment?.payment_code ||
      data?.code ||
      externalCode
    ).trim();

    const pixText = extractPixText(data);
    const pixImage = extractPixImage(data);
    const paymentStatus = normalizeResponseStatus(data?.payment_status || data?.status || "pending");

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        payment_code: paymentCode,
        payment_id: paymentCode,
        transactionId: paymentCode,
        transaction_id: paymentCode,
        status: paymentStatus,
        raw_status: data?.payment_status || data?.status || "pending",
        amount: totalAmountCents,
        total_amount: centsToReais(totalAmountCents),
        checkout_url: data?.checkout_url || null,
        pix_payload: pixText,
        pix_qrcode: pixText,
        pix_qrcode_image: pixImage,
        pix: {
          payload: pixText,
          qrcode: pixText,
          qrCode: pixText,
          image: pixImage,
          pix_qrcode_text: pixText,
          pix_qrcode_image: pixImage,
        },
        external_code: externalCode,
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
