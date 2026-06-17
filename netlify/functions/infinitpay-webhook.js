exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Signature, X-Infinit-Pay-Signature",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  let payload = {};

  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    payload = { raw: event.body || "" };
  }

  console.log("[infinitpay-webhook] received", JSON.stringify(payload));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true }),
  };
};
