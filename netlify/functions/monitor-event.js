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

  const body = safeJsonParse(event.body) || {};

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({
      success: true,
      received: {
        event_type: body.event_type || "",
        event_name: body.event_name || "",
        session_id: body.session_id || "",
        step: body.step ?? null,
        payment_id: body.payment_id || "",
        event_id: body.event_id || "",
      },
    }),
  };
};
