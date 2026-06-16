function getClientIp(event) {
  return (
    event?.headers?.["x-nf-client-connection-ip"] ||
    event?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    event?.headers?.["client-ip"] ||
    ""
  );
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text || "{}");
  } catch (_) {
    return null;
  }
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

  const pixelId = String(process.env.META_PIXEL_ID || "1005940471910890").trim();
  const accessToken = String(process.env.META_ACCESS_TOKEN || "").trim();

  if (!accessToken) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: "META_ACCESS_TOKEN nao configurado" }),
    };
  }

  const body = safeJsonParse(event.body);
  if (!body || !Array.isArray(body.data) || !body.data.length) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: "Payload invalido. Esperado: { data: [...] }" }),
    };
  }

  const ip = getClientIp(event);
  const userAgent = event.headers?.["user-agent"] || event.headers?.["User-Agent"] || "";
  const testEventCode = String(process.env.META_TEST_EVENT_CODE || "").trim();

  const normalized = body.data.map((item) => {
    const userData = Object.assign({}, item.user_data || {});
    if (!userData.client_ip_address && ip) userData.client_ip_address = ip;
    if (!userData.client_user_agent && userAgent) userData.client_user_agent = userAgent;
    return {
      event_name: item.event_name,
      event_time: item.event_time || Math.floor(Date.now() / 1000),
      event_id: item.event_id,
      action_source: item.action_source || "website",
      event_source_url: item.event_source_url || body.event_source_url || "",
      user_data: userData,
      custom_data: item.custom_data || {},
      ...(testEventCode ? { test_event_code: testEventCode } : {}),
    };
  });

  try {
    const response = await fetch(
      `https://graph.facebook.com/v19.0/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ data: normalized }),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: cors,
        body: JSON.stringify({
          error: data.error?.message || data.error?.type || "Erro ao enviar evento para a Meta",
          raw: data,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        success: true,
        result: data,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
