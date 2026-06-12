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
    const { amount, customer_name, customer_email, customer_tax_id } = JSON.parse(event.body || "{}");

    if (!amount || !customer_name || !customer_email || !customer_tax_id) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({
          error: "Faltam dados: amount, customer_name, customer_email, customer_tax_id",
        }),
      };
    }

    const apiKey = process.env.SUNIZE_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({ error: "SUNIZE_API_KEY não configurada" }),
      };
    }

    const baseUrl = (process.env.SUNIZE_BASE_URL || "https://api.sunize.com/v1").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/transactions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount,
        payment_method: "pix",
        customer: {
          name: customer_name,
          email: customer_email,
          tax_id: customer_tax_id,
        },
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: cors,
        body: JSON.stringify({
          error: data.message || data.error || "Erro ao criar transação PIX",
        }),
      };
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        pix_qrcode: data?.pix?.qrcode,
        pix_payload: data?.pix?.payload,
        transaction_id: data?.id || data?.transaction_id || null,
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
