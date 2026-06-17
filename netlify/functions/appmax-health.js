function safeJsonParse(text) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return null;
  }
}

function buildExternalId(body) {
  const incoming =
    String(body?.external_id || body?.externalId || "").trim() ||
    `appmax_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return incoming;
}

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  if (event.httpMethod === "GET") {
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ ok: true, service: "appmax-health" }),
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: cors,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  const body = safeJsonParse(event.body) || {};

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({
      external_id: buildExternalId(body),
    }),
  };
};
