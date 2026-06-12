const BEEHIVE_API = "https://api.conta.paybeehive.com.br/v1";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

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

      if (request.method === "POST" && url.pathname === "/api/webhooks/beehive") {
        return withCors(json({ received: true }), cors);
      }

      return withCors(json({ error: "not_found" }, 404), cors);
    } catch (error) {
      console.error("Payment backend error", error);
      return withCors(json({ error: "payment_backend_error" }, 500), cors);
    }
  },
};

async function createPix(request, env) {
  requireSecret(env);
  const payload = await request.json();
  const amount = Number(payload?.pricing?.totalAmount);
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
  const productTitle = ["Tapete Bandeja 3D", vehicle.brand, vehicle.model, vehicle.year]
    .filter(Boolean)
    .join(" ");

  const transaction = await beehive("/transactions", env, {
    method: "POST",
    body: JSON.stringify({
      amount,
      paymentMethod: "pix",
      customer: {
        name: String(customer.name).trim(),
        email: String(customer.email).trim(),
        document: { type: "cpf", number: digits(customer.cpf) },
      },
      items: [
        {
          title: productTitle,
          unitPrice: amount,
          quantity: 1,
          tangible: true,
        },
      ],
      pix: { expiresInSeconds: 1800 },
      metadata: {
        provider: "tapetebandeja",
        user_email: String(customer.email).trim(),
        order_id: orderId,
        checkout_url: pageUrl,
        shop_url: safeUrl(env.SHOP_URL, pageUrl),
      },
      postbackUrl: new URL("/api/webhooks/beehive", request.url).toString(),
    }),
  });

  const qrCode =
    transaction.qrCode ||
    transaction.pix?.qrCode ||
    transaction.pix?.qrcode ||
    transaction.pix?.copyPaste ||
    transaction.pixCode;

  if (!qrCode) {
    console.error("Beehive returned no Pix QR code", transaction);
    return json({ error: "beehive_missing_qrcode" }, 502);
  }

  return json({
    transactionId: String(transaction.id),
    orderReference: orderId,
    status: transaction.status,
    amount: transaction.amount,
    pix: { qrcode: qrCode },
  });
}

async function pixStatus(url, env) {
  requireSecret(env);
  const paymentId = url.searchParams.get("payment_id");
  if (!paymentId || !/^[a-zA-Z0-9_-]+$/.test(paymentId)) {
    return json({ error: "invalid_payment_id" }, 400);
  }

  const transaction = await beehive(`/transactions/${paymentId}`, env);
  return json({
    payment_id: String(transaction.id),
    status: transaction.status,
    amount: transaction.amount,
  });
}

async function beehive(path, env, init = {}) {
  const token = btoa(`${env.BEEHIVE_SECRET_KEY}:x`);
  const response = await fetch(`${BEEHIVE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("Beehive API error", response.status, data);
    throw new Error(`Beehive API returned ${response.status}`);
  }

  return data;
}

function requireSecret(env) {
  if (!env.BEEHIVE_SECRET_KEY) {
    throw new Error("BEEHIVE_SECRET_KEY is not configured");
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || origin;

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
    return "https://tapetebandeja.com/";
  }
}
