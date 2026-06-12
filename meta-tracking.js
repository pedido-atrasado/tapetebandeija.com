(function () {
  "use strict";

  var PIXEL_ID = "1761003738221606";
  var TEST_EVENT_CODE = "";
  var CAPI_ENDPOINT = "/api/meta-capi/event";
  var MONITOR_ENDPOINT = "/api/monitor/event";
  var sent = new Set();
  var monitorSent = new Set();
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;

  function nowSec() {
    return Math.floor(Date.now() / 1000);
  }

  function getCookie(name) {
    var match = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : "";
  }

  function ensureFbc() {
    var existing = getCookie("_fbc");
    if (existing) return existing;
    var fbclid = new URLSearchParams(window.location.search).get("fbclid");
    if (!fbclid) return "";
    var value = "fb.1." + Date.now() + "." + fbclid;
    document.cookie = "_fbc=" + encodeURIComponent(value) + "; path=/; max-age=7776000; SameSite=Lax; Secure";
    return value;
  }

  function hashText(value) {
    var text = String(value || "").trim().toLowerCase();
    if (!text || !window.crypto || !window.crypto.subtle) return Promise.resolve("");
    return window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buffer) {
      return Array.prototype.map.call(new Uint8Array(buffer), function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    });
  }

  function simpleHash(value) {
    var hash = 5381;
    var text = String(value || "");
    for (var i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
    return (hash >>> 0).toString(36);
  }

  function normalizeValue(value) {
    var num = Number(value);
    if (!Number.isFinite(num)) return undefined;
    return num > 1000 ? Number((num / 100).toFixed(2)) : Number(num.toFixed(2));
  }

  function cleanObject(input) {
    var out = {};
    Object.keys(input || {}).forEach(function (key) {
      var value = input[key];
      if (value !== undefined && value !== null && value !== "") out[key] = value;
    });
    return out;
  }

  function getUtm() {
    var params = new URLSearchParams(window.location.search);
    return cleanObject({
      utm_source: params.get("utm_source"),
      utm_medium: params.get("utm_medium"),
      utm_campaign: params.get("utm_campaign"),
      utm_content: params.get("utm_content"),
      utm_term: params.get("utm_term"),
      fbclid_present: params.has("fbclid"),
      fbp_present: Boolean(getCookie("_fbp")),
      fbc_present: Boolean(getCookie("_fbc") || params.has("fbclid")),
    });
  }

  function stepFromText(text) {
    if (/Pedido em confirmação|Pagamento confirmado/i.test(text)) return 9;
    if (/Pix copia e cola|Copiar código Pix|QRCode|QR Code/i.test(text)) return 8;
    if (/Confira veículo, kit, cor, entrega e dados/i.test(text)) return 7;
    if (/Escolha a cor|cor do tapete/i.test(text)) return 6;
    if (/O que vem no seu kit|Conteúdo do kit/i.test(text)) return 5;
    if (/Escolha o kit|Valor do kit/i.test(text)) return 4;
    if (/Compatibilidade|Não é tapete universal/i.test(text)) return 3;
    if (/Selecione o modelo|Selecione a marca|ano do veículo/i.test(text)) return 2;
    if (/tipo de veículo|carroceria|Hatch|Sedan|SUV|Caminonete/i.test(text)) return 1;
    return 0;
  }

  function getInputValue(id) {
    var el = document.getElementById(id);
    return el && "value" in el ? el.value : "";
  }

  function checkoutFormSnapshot() {
    return cleanObject({
      customer: cleanObject({
        name: getInputValue("name"),
        email: getInputValue("email"),
        phone: getInputValue("phone"),
        cpf: getInputValue("cpf"),
      }),
      shipping: {
        address: cleanObject({
          zipCode: getInputValue("zipCode"),
          street: getInputValue("street"),
          streetNumber: getInputValue("streetNumber"),
          complement: getInputValue("complement"),
          neighborhood: getInputValue("neighborhood"),
          city: getInputValue("city"),
        }),
      },
    });
  }

  function domSnapshot(extra) {
    var text = (document.body && document.body.textContent || "").replace(/\s+/g, " ").trim();
    return cleanObject(Object.assign({
      step_text: text.slice(0, 900),
      title: document.title,
      form: checkoutFormSnapshot(),
    }, extra || {}));
  }

  function postMonitor(eventType, eventName, step, data, options) {
    options = options || {};
    if (!nativeFetch) return;
    var sessionId = getSessionId();
    var key = options.idempotencyKey || [eventType, eventName, sessionId, step, simpleHash(JSON.stringify(data || {}))].join(":");
    if (monitorSent.has(key)) return;
    monitorSent.add(key);
    nativeFetch(MONITOR_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event_type: eventType,
        event_name: eventName,
        session_id: sessionId,
        step: step,
        payment_id: options.paymentId || "",
        event_id: options.eventId || "",
        idempotency_key: key,
        source: "frontend",
        page_url: window.location.href,
        utm: getUtm(),
        data: data || {},
      }),
      keepalive: true,
    }).catch(function () {});
  }

  function splitName(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    return { firstName: parts[0] || "", lastName: parts.length > 1 ? parts[parts.length - 1] : "" };
  }

  function buildUserData(customer) {
    customer = customer || {};
    var name = splitName(customer.name);
    return Promise.all([
      hashText(customer.email),
      hashText(String(customer.phone || "").replace(/\D/g, "")),
      hashText(name.firstName),
      hashText(name.lastName),
      hashText(customer.city),
      hashText(customer.state),
      hashText(String(customer.zipCode || "").replace(/\D/g, "")),
      hashText(customer.externalId),
      hashText("br"),
    ]).then(function (hashes) {
      return cleanObject({
        em: hashes[0] ? [hashes[0]] : undefined,
        ph: hashes[1] ? [hashes[1]] : undefined,
        fn: hashes[2] ? [hashes[2]] : undefined,
        ln: hashes[3] ? [hashes[3]] : undefined,
        ct: hashes[4] ? [hashes[4]] : undefined,
        st: hashes[5] ? [hashes[5]] : undefined,
        zp: hashes[6] ? [hashes[6]] : undefined,
        country: hashes[8] ? [hashes[8]] : undefined,
        external_id: hashes[7] ? [hashes[7]] : undefined,
        client_user_agent: navigator.userAgent,
        fbp: getCookie("_fbp"),
        fbc: ensureFbc(),
      });
    });
  }

  function initPixel() {
    if (window.fbq) return;
    !function(f,b,e,v,n,t,s) {
      if (f.fbq) return;
      n = f.fbq = function(){ n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
      t = b.createElement(e); t.async = true; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    window.fbq("init", PIXEL_ID);
  }

  function fire(eventName, eventId, customData, customer, serverOnly) {
    if (!eventName) return;
    eventId = eventId || eventName + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    var key = eventName + ":" + eventId;
    if (sent.has(key)) return;
    sent.add(key);
    try { sessionStorage.setItem("meta_sent:" + key, "1"); } catch (_) {}
    postMonitor("meta_browser_attempt", eventName, undefined, {
      event_id: eventId,
      custom_data: customData || {},
      browser_pixel_attempted: !serverOnly,
    }, { eventId: eventId, idempotencyKey: "meta_browser:" + key });

    customData = cleanObject(Object.assign({}, customData || {}));
    if (customData.value !== undefined) customData.value = normalizeValue(customData.value);
    if (customData.value !== undefined && !customData.currency) customData.currency = "BRL";

    if (!serverOnly && window.fbq) {
      var browserData = Object.assign({}, customData);
      if (TEST_EVENT_CODE) browserData.test_event_code = TEST_EVENT_CODE;
      window.fbq("track", eventName, browserData, { eventID: eventId });
    }

    buildUserData(customer).then(function (userData) {
      var payload = {
        data: [{
          event_name: eventName,
          event_time: nowSec(),
          event_id: eventId,
          action_source: "website",
          event_source_url: window.location.href,
          user_data: userData,
          custom_data: customData,
        }],
      };
      if (nativeFetch) {
        nativeFetch(CAPI_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(function () {});
      }
    });
  }

  function parseRequestBody(init) {
    try {
      if (!init || !init.body || typeof init.body !== "string") return null;
      return JSON.parse(init.body);
    } catch (_) {
      return null;
    }
  }

  function customerFromCheckout(payload) {
    var customer = payload.customer || {};
    var address = ((payload.shipping || {}).address || {});
    return {
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      city: address.city,
      state: address.state,
      zipCode: address.zipCode,
      externalId: getSessionId(),
    };
  }

  function customDataFromCheckout(payload, paymentId) {
    var vehicle = payload.vehicle || {};
    var pricing = payload.pricing || {};
    return {
      content_name: "Tapete Bandeja 3D",
      content_type: "product",
      currency: "BRL",
      value: normalizeValue(pricing.totalAmount),
      order_id: paymentId,
      vehicle_type: vehicle.type,
      brand: vehicle.brand,
      model: vehicle.model,
      year: vehicle.year,
      color: vehicle.color,
      kit: vehicle.kit,
    };
  }

  function getSessionId() {
    try {
      var current = sessionStorage.getItem("apps_session_id");
      if (current) return current;
      current = Date.now() + "_" + Math.random().toString(36).slice(2, 9);
      sessionStorage.setItem("apps_session_id", current);
      return current;
    } catch (_) {
      return "anonymous";
    }
  }

  function rememberCheckout(payload, result) {
    try {
      var paymentId = String((result || {}).transactionId || "");
      sessionStorage.setItem("meta_last_checkout", JSON.stringify({ paymentId: paymentId, payload: payload, result: result || {} }));
      postMonitor("pix_generated", "PixGenerated", 8, {
        payment_status: (result || {}).status,
        amount: (result || {}).amount,
        payment_id: paymentId,
        vehicle: payload.vehicle,
        pricing: payload.pricing,
        customer: payload.customer,
        shipping: payload.shipping,
      }, { paymentId: paymentId, idempotencyKey: "pix_generated:" + paymentId });
    } catch (_) {}
  }

  function loadLastCheckout(paymentId) {
    try {
      var stored = JSON.parse(sessionStorage.getItem("meta_last_checkout") || "null");
      if (!stored || (paymentId && String(stored.paymentId) !== String(paymentId))) return null;
      return stored;
    } catch (_) {
      return null;
    }
  }

  function patchFetch() {
    if (!nativeFetch) return;
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : String((input && input.url) || "");
      var isPixCreate = url.indexOf("/api/checkout/pix") !== -1;
      var isPixStatus = url.indexOf("/api/pix/status") !== -1;
      var checkoutPayload = isPixCreate ? parseRequestBody(init) : null;

      if (checkoutPayload) {
        checkoutPayload.tracking = Object.assign({}, checkoutPayload.tracking || {}, { sessionId: getSessionId() });
        var checkoutEventId = "AddPaymentInfo_" + simpleHash(JSON.stringify(checkoutPayload));
        postMonitor("checkout", "CheckoutCompleted", 7, {
          vehicle: checkoutPayload.vehicle,
          pricing: checkoutPayload.pricing,
          customer: checkoutPayload.customer,
          shipping: checkoutPayload.shipping,
        }, { idempotencyKey: "checkout:" + checkoutEventId });
        fire("AddPaymentInfo", checkoutEventId, customDataFromCheckout(checkoutPayload), customerFromCheckout(checkoutPayload));
      }

      return nativeFetch(input, init).then(function (response) {
        if (!isPixCreate && !isPixStatus) return response;
        var clone = response.clone();
        clone.json().then(function (data) {
          if (isPixCreate && checkoutPayload && response.ok) {
            rememberCheckout(checkoutPayload, data);
          }
          if (isPixStatus && data && data.status === "paid") {
            var paymentId = String(data.payment_id || new URL(url, window.location.origin).searchParams.get("payment_id") || "");
            var stored = loadLastCheckout(paymentId);
            var checkout = stored && stored.payload;
            var customData = checkout ? customDataFromCheckout(checkout, paymentId) : {
              content_name: "Tapete Bandeja 3D",
              content_type: "product",
              currency: "BRL",
              value: normalizeValue(data.amount),
              order_id: paymentId,
            };
            fire("Purchase", data.meta_event_id || ("purchase_" + paymentId), customData, checkout ? customerFromCheckout(checkout) : undefined, false);
            postMonitor("pix_paid", "PaymentConfirmed", 9, {
              status: data.status,
              amount: data.amount,
              payment_id: paymentId,
              meta_event_id: data.meta_event_id,
              vehicle: checkout ? checkout.vehicle : undefined,
              customer: checkout ? checkout.customer : undefined,
              shipping: checkout ? checkout.shipping : undefined,
            }, { paymentId: paymentId, eventId: data.meta_event_id, idempotencyKey: "pix_paid:" + paymentId });
          }
        }).catch(function () {});
        return response;
      });
    };
  }

  function observeFunnel() {
    var seenSummary = false;
    var lastStepKey = "";
    document.addEventListener("click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("button,a") : null;
      if (!target) return;
      var text = (target.textContent || "").replace(/\s+/g, " ").trim();
      var step = stepFromText(document.body ? document.body.textContent || "" : "");
      postMonitor("click", "UserClicked", step, domSnapshot({ clicked_text: text.slice(0, 180) }), {
        idempotencyKey: "click:" + getSessionId() + ":" + Date.now() + ":" + simpleHash(text),
      });
      if (/VEJA O QUE VEM NO SEU KIT/i.test(text)) {
        fire("AddToCart", "AddToCart_" + simpleHash(getSessionId() + ":" + Date.now()), {
          content_name: "Tapete Bandeja 3D",
          content_type: "product",
          currency: "BRL",
        });
      }
      if (/Tenho duvida|WhatsApp|suporte/i.test(text)) {
        fire("Contact", "Contact_" + simpleHash(getSessionId() + ":" + Date.now()), {
          content_name: "Tapete Bandeja 3D",
        });
      }
    }, true);

    document.addEventListener("input", function (event) {
      var target = event.target;
      if (!target || !target.id || !/^(name|email|phone|cpf|zipCode|street|streetNumber|complement|neighborhood|city)$/.test(target.id)) return;
      window.clearTimeout(window.__monitorInputTimer);
      window.__monitorInputTimer = window.setTimeout(function () {
        postMonitor("form", "CheckoutFormUpdated", 7, checkoutFormSnapshot(), {
          idempotencyKey: "form:" + getSessionId() + ":" + simpleHash(JSON.stringify(checkoutFormSnapshot())),
        });
      }, 700);
    }, true);

    var observer = new MutationObserver(function () {
      var text = document.body ? document.body.textContent || "" : "";
      var step = stepFromText(text);
      var stepKey = "step:" + getSessionId() + ":" + step + ":" + simpleHash(text.slice(0, 1200));
      if (stepKey !== lastStepKey) {
        lastStepKey = stepKey;
        postMonitor("funnel_step", "StepViewed", step, domSnapshot(), { idempotencyKey: stepKey });
      }
      if (seenSummary) return;
      if (/Confira veículo, kit, cor, entrega e dados antes de gerar o Pix/i.test(text)) {
        seenSummary = true;
        fire("InitiateCheckout", "InitiateCheckout_" + simpleHash(getSessionId()), {
          content_name: "Tapete Bandeja 3D",
          content_category: "checkout",
          currency: "BRL",
        });
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  initPixel();
  ensureFbc();
  patchFetch();
  observeFunnel();
  postMonitor("pageview", "FunnelEntered", 0, domSnapshot(), { idempotencyKey: "pageview:" + getSessionId() + ":" + location.pathname });
  fire("PageView", "PageView_" + simpleHash(getSessionId() + ":" + location.pathname), {
    content_name: "Tapete Bandeja 3D",
    content_category: "apps",
  });
})();
