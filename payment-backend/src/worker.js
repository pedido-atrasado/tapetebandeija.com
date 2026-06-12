const DEFAULT_SUNIZE_BASE = "https://api.sunize.com.br";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env, request.headers.get("Origin") || "");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (request.method === "POST" && url.pathname === "/api/checkout/pix") {
        return withCors(await createPix(request, env), cors);
      }

      if (request.method === "GET" && url.pathname === "/api/pix/status") {
        return withCors(await pixStatus(url, env), cors);
      }

      return withCors(json({ error: "not_found" }, 404), cors);
    } catch (error) {
      console.error("Payment backend error", error);
      return withCors(
        json({ error: "payment_backend_error", message: error instanceof Error ? error.message : String(error) }, 500),
        cors,
      );
    }
  },
};

async function createPix(request, env) {
  requireConfig(env);
  const payload = await request.json();
  const amount = amountInCents(payload);
  const customer = payload?.customer || {};
  const vehicle = payload?.vehicle || {};
  const pageUrl = safeUrl(payload?.tracking?.pageUrl, env.SHOP_URL);

  if (!Number.isInteger(amount) || amount < 100) {
    return json({ error: "invalid_amount" }, 400);
  }

  if (!customer.name || !customer.email || digits(customer.cpf).length !== 11) {
    return json({ error: "invalid_customer" }, 400);
  }

  const orderId = crypto.randomUUID();
  const itemTitle = ["Tapete Bandeja 3D", vehicle.brand, vehicle.model, vehicle.year]
    .filter(Boolean)
    .join(" ");

  const transaction = await sunize("/v1/transactions", env, {
    method: "POST",
    body: JSON.stringify({
      amount,
      paymentMethod: "pix",
      customer: {
        name: String(customer.name).trim(),
        email: String(customer.email).trim(),
        phone: String(customer.phone || "").trim(),
        document: {
          type: "cpf",
          number: digits(customer.cpf),
        },
      },
      items: [
        {
          title: itemTitle,
          unitPrice: amount,
          quantity: 1,
          tangible: true,
        },
      ],
      metadata: {
        provider: "tapetebandeja",
        order_id: orderId,
        checkout_url: pageUrl,
        shop_url: safeUrl(env.SHOP_URL, pageUrl),
      },
      postbackUrl: new URL("/api/webhooks/sunize", request.url).toString(),
      pix: { expiresInSeconds: 1800 },
    }),
  });

  const pix = extractPix(transaction);
  if (!pix.payload && !pix.qrcode) {
    console.error("Sunize returned no Pix data", transaction);
    return json({ error: "sunize_missing_pix_data" }, 502);
  }

  return json({
    transactionId: String(transaction.id || transaction.transactionId || orderId),
    orderReference: orderId,
    status: String(transaction.status || "pending"),
    amount,
    pix,
  });
}

async function pixStatus(url, env) {
  requireConfig(env);
  const transactionId = url.searchParams.get("transaction_id") || url.searchParams.get("payment_id");

  if (!transactionId || !/^[a-zA-Z0-9_-]+$/.test(transactionId)) {
    return json({ error: "invalid_transaction_id" }, 400);
  }

  const transaction = await sunize(`/v1/transactions/${transactionId}`, env);
  return json({
    transactionId: String(transaction.id || transactionId),
    status: String(transaction.status || "unknown"),
    amount: amountInCents({ pricing: { totalAmount: transaction.amount || transaction.value || 0 } }),
  });
}

async function sunize(path, env, init = {}) {
  const baseUrl = String(env.SUNIZE_BASE_URL || DEFAULT_SUNIZE_BASE).replace(/\/$/, "");
  const apiKey = String(env.SUNIZE_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("SUNIZE_API_KEY is not configured");
  }

  const authHeader = String(env.SUNIZE_AUTH_HEADER || "Authorization");
  const authPrefix = String(env.SUNIZE_AUTH_PREFIX || "Bearer");
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      [authHeader]: authPrefix ? `${authPrefix} ${apiKey}`.trim() : apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    console.error("Sunize API error", response.status, data);
    throw new Error(`Sunize API returned ${response.status}`);
  }

  return data;
}

function extractPix(transaction) {
  const pix = transaction?.pix || {};
  const payload = pix.payload || pix.copyPaste || pix.copiaECola || pix.qrCode || pix.qrcode || transaction?.payload || "";
  const qrcode = pix.qrcode || pix.qrCode || transaction?.qrcode || "";
  return { payload: String(payload || ""), qrcode: String(qrcode || "") };
}

function amountInCents(payload) {
  const raw = payload?.pricing?.totalAmount ?? payload?.amount ?? payload?.value ?? 0;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0;
  if (Number.isInteger(value) && value > 1000) return value;
  return Math.round(value);
}

function requireConfig(env) {
  if (!env.SUNIZE_API_KEY) {
    throw new Error("SUNIZE_API_KEY is not configured");
  }
}

function corsHeaders(request, env, origin) {
  const allowed = String(env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || origin || "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    Vary: "Origin",
  };
}

function withCors(response, cors) {
  const headers = new Headers(response.headers);
  Object.entries(cors).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, { status: response.status, headers });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function safeUrl(value, fallback) {
  try {
    return new URL(value || fallback).toString();
  } catch {
    return String(fallback || DEFAULT_SUNIZE_BASE);
  }
}
