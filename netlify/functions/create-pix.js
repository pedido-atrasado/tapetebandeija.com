const DEFAULT_SITE_URL = "https://tapetebandeja.netlify.app";
const DEFAULT_POSTBACK_PATH = "/api/risepay/webhook";
const RISEPAY_API_BASE = "https://api.risepay.com.br";

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

function getPostbackUrl() {
  return `${getSiteBaseUrl()}${DEFAULT_POSTBACK_PATH}`;
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

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value) return "pending";
  if (["paid", "approved", "authorized", "closed", "paid "].includes(value)) return "paid";
  if (["waiting payment", "waiting_payment", "pending", "in_process", "processing", "waiting"].includes(value)) return "pending";
  if (["refused", "canceled", "cancelled", "expired", "chargeback", "gateway_error", "system_error", "refunded", "underpaid", "overpaid"].includes(value)) return "failed";
  return value;
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
    const privateToken = getPrivateToken();
    if (!privateToken) {
      throw new Error("RISEPAY_PRIVATE_TOKEN nao configurado");
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
      amount: Number((totalAmountCents / 100).toFixed(2)),
      currency: "BRL",
      payment: {
        method: "pix",
        expiresAt: 48,
      },
      customer: {
        name: String(customer.name || "").trim(),
        email: String(customer.email || "").trim(),
        cpf: normalizeDigits(customer.cpf),
        phone: normalizePhoneForGateway(customer.phone || customer.phone_number || ""),
        address: {
          street: String(shipping?.address?.street || body?.address?.street || "").trim(),
          number: String(shipping?.address?.number || body?.address?.number || "").trim(),
          complement: String(shipping?.address?.complement || body?.address?.complement || "").trim(),
          neighborhood: String(shipping?.address?.neighborhood || body?.address?.neighborhood || "").trim(),
          city: String(shipping?.address?.city || body?.address?.city || "").trim(),
          state: String(shipping?.address?.state || body?.address?.state || "").trim(),
          zipCode: normalizeDigits(shipping?.address?.zipCode || body?.address?.zipCode || ""),
        },
      },
      tracking: {
        src: tracking.src || "checkout_web",
        utmSource: tracking.utmSource || "",
        utmMedium: tracking.utmMedium || "",
        utmCampaign: tracking.utmCampaign || "",
        utmTerm: tracking.utmTerm || "",
        utmContent: tracking.utmContent || "",
        utmId: tracking.utmId || "",
      },
      postBackUrl: getPostbackUrl(),
      externalReference: externalCode,
      metadata: {
        pedido_origem: "checkout-api",
        vehicle_type: vehicle.type || "",
        brand: vehicle.brand || "",
        model: vehicle.model || "",
        year: vehicle.year || "",
        color: vehicle.color || "",
        kit: vehicle.kit || "",
        shipping_label: shipping.label || "",
        shipping_deadline: shipping.deadline || "",
      },
      items: [
        {
          id: "tapete-bandeja",
          description: `Tapete Bandeja ${vehicle.brand || ""} ${vehicle.model || ""}`.trim(),
          quantity: 1,
          price: Number((kitAmountCents / 100).toFixed(2)),
        },
      ],
      productList: [
        {
          name: `Tapete Bandeja ${vehicle.brand || ""} ${vehicle.model || ""}`.trim(),
          value: Number((kitAmountCents / 100).toFixed(2)),
          sku: "tapete-bandeja",
        },
      ],
    };

    const response = await fetch(`${RISEPAY_API_BASE}/api/External/Transactions`, {
      method: "POST",
      headers: {
        Authorization: privateToken,
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
            "Nao foi possivel gerar o Pix na RisePay",
          raw: data,
        }),
      };
    }

    const object = data?.object || data || {};
    const paymentCode = String(object?.identifier || object?.paymentId || externalCode).trim();
    const pixText = extractPixText(data);
    const pixImage = extractPixImage(data);
    const rawStatus = object?.status || data?.status || "Waiting Payment";

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        payment_code: paymentCode,
        payment_id: paymentCode,
        transactionId: paymentCode,
        transaction_id: paymentCode,
        status: normalizeStatus(rawStatus),
        raw_status: rawStatus,
        amount: totalAmountCents,
        total_amount: Number((totalAmountCents / 100).toFixed(2)),
        checkout_url: object?.checkout_url || null,
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
