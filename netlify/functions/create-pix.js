function toE164(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return `+${digits}`;
  return `+55${digits}`;
}

function getClientIp(event) {
  return (
    event?.headers?.["x-nf-client-connection-ip"] ||
    event?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    event?.headers?.["client-ip"] ||
    ""
  );
}

function normalizeZeroOnePayStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value) return "pending";
  if (["paid", "authorized", "approved"].includes(value)) return "paid";
  if (["waiting payment", "waiting_payment", "pending", "waiting"].includes(value)) return "pending";
  if (["refused", "failed", "canceled", "cancelled"].includes(value)) return "failed";
  if (["chargeback", "refund", "refunded"].includes(value)) return "chargeback";
  return value;
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

    const totalAmountCents = Number(
      pricing.totalAmountCents ?? pricing.totalAmount ?? body.amount ?? 0
    );
    const totalAmount = Number.isFinite(totalAmountCents)
      ? totalAmountCents > 1000
        ? Number((totalAmountCents / 100).toFixed(2))
        : totalAmountCents
      : 0;

    if (!totalAmount || !customer.name || !customer.email || !customer.cpf) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({
          error: "Faltam dados: totalAmount, customer.name, customer.email, customer.cpf",
        }),
      };
    }

    const apiToken = process.env.ZEROONEPAY_API_TOKEN || process.env.ZEROONEPAY_TOKEN || "";
    if (!apiToken) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({
          error: "ZEROONEPAY_API_TOKEN nao configurado",
        }),
      };
    }

    const offerHash = String(process.env.ZEROONEPAY_OFFER_HASH || "").trim();
    if (!offerHash) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({
          error: "ZEROONEPAY_OFFER_HASH nao configurado",
        }),
      };
    }

    const baseUrl = (process.env.ZEROONEPAY_BASE_URL || "https://api.zeroonepay.com.br/api/public/v1").replace(/\/$/, "");
    const externalId =
      String(tracking.sessionId || tracking.pageUrl || body.external_id || "")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 60) || `tapete_${Date.now()}`;

    const response = await fetch(`${baseUrl}/transactions?api_token=${encodeURIComponent(apiToken)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: totalAmount,
        offer_hash: offerHash,
        payment_method: "pix",
        customer: {
          name: String(customer.name || "").trim(),
          email: String(customer.email || "").trim(),
          phone_number: String(customer.phone || customer.phone_number || "").replace(/\D/g, ""),
          document: String(customer.cpf || customer.document || "").replace(/\D/g, ""),
          street_name: String(shipping?.address?.street || "").trim(),
          number: String(shipping?.address?.streetNumber || shipping?.address?.number || "").trim(),
          complement: String(shipping?.address?.complement || "").trim(),
          neighborhood: String(shipping?.address?.neighborhood || "").trim(),
          city: String(shipping?.address?.city || "").trim(),
          state: String(shipping?.address?.state || "").trim(),
          zip_code: String(shipping?.address?.zipCode || "").trim(),
        },
        transaction_origin: "api",
        expire_in_days: 1,
        tracking: {
          src: "tapete-bandeja",
          utm_source: tracking.utmSource || "",
          utm_medium: tracking.utmMedium || "",
          utm_campaign: tracking.utmCampaign || "",
          utm_term: tracking.utmTerm || "",
          utm_content: tracking.utmContent || "",
        },
        postback_url:
          `${process.env.URL || process.env.DEPLOY_PRIME_URL || ""}`.replace(/\/$/, "") +
          "/api/zeroonepay/webhook",
        metadata: {
          vehicle,
          pricing,
          shipping,
          external_id: externalId,
          ip: getClientIp(event),
          utm_id: tracking.utmId || "",
        },
      }),
    });

    const data = await response.json().catch(() => ({}));

    const object = data?.data || data?.object || data;

    if (!response.ok || data?.hasError || data?.success === false) {
      return {
        statusCode: response.status || 400,
        headers: cors,
        body: JSON.stringify({
          error: data.message || data.error || data.details || data.response || "Erro ao criar transacao PIX",
          raw: data,
        }),
      };
    }

    const paymentId = String(object?.hash || object?.identifier || object?.id || data?.hash || "");
    const payload = String(object?.pix_code || object?.qr_code || object?.pix?.qrCode || object?.pix?.payload || data?.pix_code || data?.qr_code || data?.pix?.qrCode || data?.pix?.payload || "");
    const qrCode = String(object?.qr_code || object?.pix?.qrCode || object?.pix?.payload || data?.qr_code || data?.pix?.qrCode || data?.pix?.payload || payload);
    const normalizedStatus = normalizeZeroOnePayStatus(object?.status || data?.status);

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        transactionId: paymentId || null,
        transaction_id: paymentId || null,
        payment_id: paymentId || null,
        status: normalizedStatus,
        raw_status: object?.status || data?.status || null,
        total_amount: object?.amount ?? data?.amount ?? totalAmount,
        pix_payload: payload,
        pix_qrcode: qrCode,
        pix: {
          payload,
          qrcode: qrCode,
          qrCode,
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
