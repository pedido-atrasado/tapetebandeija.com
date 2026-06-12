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

    const apiKey = process.env.SUNIZE_API_KEY;
    const apiSecret = process.env.SUNIZE_API_SECRET;
    if (!apiKey || !apiSecret) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({
          error: "SUNIZE_API_KEY ou SUNIZE_API_SECRET nao configurada",
        }),
      };
    }

    const baseUrl = (process.env.SUNIZE_BASE_URL || "https://api.sunize.com.br/v1").replace(/\/$/, "");
    const externalId =
      String(tracking.sessionId || tracking.pageUrl || body.external_id || "")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 60) || `tapete_${Date.now()}`;

    const response = await fetch(`${baseUrl}/transactions`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "x-api-secret": apiSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        external_id: externalId,
        total_amount: totalAmount,
        payment_method: "PIX",
        items: [
          {
            id: vehicle.kit || "tapete-bandeja-3d",
            title: "Tapete Bandeja 3D",
            description: `${vehicle.brand || ""} ${vehicle.model || ""} ${vehicle.year || ""}`.trim(),
            price: totalAmount,
            quantity: 1,
            is_physical: true,
          },
        ],
        ip: getClientIp(event),
        customer: {
          name: String(customer.name || "").trim(),
          email: String(customer.email || "").trim(),
          phone: toE164(customer.phone),
          document_type: "CPF",
          document: String(customer.cpf || "").replace(/\D/g, ""),
        },
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data?.hasError) {
      return {
        statusCode: response.status || 400,
        headers: cors,
        body: JSON.stringify({
          error: data.message || data.error || data.details || data.response || 'Erro ao criar transacao PIX',
          raw: data,
        }),
      };
    }

    const payload = data?.pix?.payload || "";

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        transaction_id: data?.id || null,
        status: data?.status || "PENDING",
        total_amount: data?.total_value ?? totalAmount,
        pix_payload: payload,
        pix_qrcode: payload,
        pix: {
          payload,
          qrcode: payload,
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
