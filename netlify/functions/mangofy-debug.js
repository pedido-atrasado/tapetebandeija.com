exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

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

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      hasApiKey: Boolean(apiKey),
      hasStoreCode: Boolean(storeCode),
      apiKeyLength: apiKey.length,
      storeCodeLength: storeCode.length,
      siteUrl: String(process.env.SITE_URL || "").trim() || null,
      allowedOrigin: String(process.env.ALLOWED_ORIGIN || "").trim() || null,
    }),
  };
};
