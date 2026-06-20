const DEFAULT_SITE_URL = "https://tapetebandeja.netlify.app";
const DEFAULT_WEBHOOK_PATH = "/api/vega/webhook";

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
    DEFAULT_SITE_URL
  ).replace(/\/$/, "");
}

function getWebhookUrl() {
  return `${getSiteBaseUrl()}${DEFAULT_WEBHOOK_PATH}`;
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

  try {
    return new URL(getCheckoutBaseUrl()).hostname;
  } catch {
    return new URL(getSiteBaseUrl()).hostname;
  }
}

function buildHeaders() {
  const apiKey = getApiKey();
  const domain = getDomainHeader();

  if (!apiKey) {
    throw new Error("VEGA_API_KEY/VEGA_CLIENT_SECRET nao configurado");
  }
  if (!domain) {
    throw new Error("VEGA_DOMAIN nao configurado");
  }

  return {
    "api-key": apiKey,
    "x-domain": domain,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value) return "pending";
  if (["paid", "approved", "authorized", "closed"].includes(value)) return "paid";
  if (["pending", "waiting", "waiting_payment", "in_process", "processing", "success"].includes(value)) return "pending";
  if (["refused", "canceled", "cancelled", "expired", "gateway_error", "system_error", "failed"].includes(value)) return "failed";
  return value;
}

function buildCustomerAddress(shipping, body) {
  const address = shipping?.address || body?.address || body?.customer?.address || {};
  return {
    street: String(address.street || "").trim(),
    number: String(address.number || "").trim(),
    complement: String(address.complement || "").trim(),
    district: String(address.neighborhood || address.district || "").trim(),
    city: String(address.city || "").trim(),
    state: String(address.state || "").trim(),
    zipcode: normalizeDigits(address.zipCode || address.zipcode || ""),
    country: "BR",
  };
}

function extractVegaResponse(root) {
  const data = root?.data || root || {};
  const pixText =
    data?.pix_copy_paste ||
    data?.pix_qrcode_text ||
    data?.pix_qrcode ||
    data?.pix?.pix_copy_paste ||
    data?.pix?.pix_qrcode_text ||
    data?.pix?.qrcode ||
    root?.pix_copy_paste ||
    "";

  const pixImage =
    data?.pix_code_image64 ||
    data?.pix_qrcode_image64 ||
    data?.pix_qrcode_image ||
    data?.pix?.pix_code_image64 ||
    data?.pix?.pix_qrcode_image ||
    root?.pix_code_image64 ||
    "";

  const paymentCode =
    data?.transaction_token ||
    data?.payment_code ||
    data?.external_code ||
    root?.transaction_token ||
    "";

  const rawStatus = data?.payment_status || data?.status || root?.payment_status || root?.status || "pending";

  return { pixText, pixImage, paymentCode, rawStatus, data };
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
    const checkoutBaseUrl = getCheckoutBaseUrl();
    const apiKey = getApiKey();
    const domain = getDomainHeader();

    if (!apiKey) {
      throw new Error("VEGA_API_KEY nao configurado");
    }

    const body = JSON.parse(event.body || "{}");
    const vehicle = body.vehicle || {};
    const pricing = body.pricing || {};
    const shipping = body.shipping || {};
    const customer = body.customer || {};
    const tracking = body.tracking || {};

    const totalAmountCents = Number(pricing.totalAmountCents ?? pricing.totalAmount ?? body.amount ?? 0) || 0;
    const kitAmountCents = Number(pricing.kitAmountCents ?? 0) || Math.max(totalAmountCents - Number(pricing.shippingAmountCents ?? 0), 0);
    const shippingAmountCents = Number(pricing.shippingAmountCents ?? 0) || 0;
    const discountAmountCents = Number(pricing.pixDiscountCents ?? 0) || 0;

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
      customer: {
        name: String(customer.name || "").trim(),
        email: String(customer.email || "").trim(),
        document: normalizeDigits(customer.cpf),
        phone: normalizePhoneForGateway(customer.phone || customer.phone_number || ""),
        address: buildCustomerAddress(shipping, body),
      },
      payment: {
        method: "pix",
        payment_value: totalAmountCents,
        freight_value: shippingAmountCents,
        discount_value: discountAmountCents,
        external_code: externalCode,
        currency: "BRL",
      },
      products: [
        {
          code: "tapete-bandeja",
          name: `Tapete Bandeja ${vehicle.brand || ""} ${vehicle.model || ""}`.trim(),
          price: kitAmountCents || totalAmountCents,
          quantity: 1,
          is_digital: false,
          description: "Tapete Bandeja 3D",
          image_url: String(vehicle.image || "").trim(),
        },
      ],
      notification_url: getWebhookUrl(),
      src: tracking.src || "checkout_web",
      utm_medium: tracking.utmMedium || "",
      utm_source: tracking.utmSource || "",
      utm_campaign: tracking.utmCampaign || "",
      utm_content: tracking.utmContent || "",
      utm_term: tracking.utmTerm || "",
    };

    const response = await fetch(`${checkoutBaseUrl}/api/checkout`, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "x-domain": domain,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: cors,
        body: JSON.stringify({
          error:
            data?.message ||
            data?.error ||
            data?.errors?.[0]?.message ||
            "Nao foi possivel gerar o Pix na Vega",
          raw: data,
        }),
      };
    }

    const extracted = extractVegaResponse(data);
    const paymentCode = String(extracted.paymentCode || externalCode).trim();

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
        amount: totalAmountCents,
        total_amount: centsToReais(totalAmountCents),
        checkout_url: extracted.data?.order_url || extracted.data?.checkout_url || null,
        pix_payload: extracted.pixText,
        pix_qrcode: extracted.pixText,
        pix_qrcode_image: extracted.pixImage,
        pix: {
          payload: extracted.pixText,
          qrcode: extracted.pixText,
          qrCode: extracted.pixText,
          image: extracted.pixImage,
          pix_qrcode_text: extracted.pixText,
          pix_qrcode_image: extracted.pixImage,
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
