export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    };

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers
      });

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        success: true,
        service: "HR UNIVERSE",
        status: "running"
      });
    }

    if (url.pathname === "/api/orders" && request.method === "POST") {
      try {
        const text = await request.text();

        if (text.length > 20000) {
          return json({ success: false, error: "Request too large" }, 413);
        }

        const data = JSON.parse(text);

        const productId = String(data.product_id || "").trim();
        const productName = String(data.product_name || "").trim();
        const customerName = String(data.customer_name || "").trim();
        const phone = String(data.customer_phone || "").trim();
        const address = String(data.customer_address || "").trim();
        const district = String(data.district || "").trim();

        const unitPrice = Number(data.unit_price);
        const quantity = Number(data.quantity);

        if (
          !productId ||
          !productName ||
          !customerName ||
          !phone ||
          !address ||
          !Number.isSafeInteger(unitPrice) ||
          unitPrice < 0 ||
          !Number.isSafeInteger(quantity) ||
          quantity < 1 ||
          quantity > 100
        ) {
          return json({
            success: false,
            error: "Please provide valid order information"
          }, 400);
        }

        if (
          productId.length > 100 ||
          productName.length > 200 ||
          customerName.length > 120 ||
          phone.length > 30 ||
          address.length > 1000 ||
          district.length > 100
        ) {
          return json({
            success: false,
            error: "One or more fields are too long"
          }, 400);
        }

        const total = unitPrice * quantity;

        if (!Number.isSafeInteger(total)) {
          return json({
            success: false,
            error: "Invalid order total"
          }, 400);
        }

        const id = crypto.randomUUID();
        const createdAt = new Date().toISOString();

        await env.DB.prepare(`
          INSERT INTO orders (
            id, product_id, product_name, unit_price,
            quantity, total, payment_method, customer_name,
            customer_phone, customer_address, district,
            status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          id,
          productId,
          productName,
          unitPrice,
          quantity,
          total,
          "COD",
          customerName,
          phone,
          address,
          district || null,
          "PENDING",
          createdAt
        ).run();

        return json({
          success: true,
          message: "Order received",
          order: {
            id,
            total,
            payment_method: "COD",
            status: "PENDING"
          }
        }, 201);
      } catch (error) {
        return json({
          success: false,
          error: "Unable to process order"
        }, 500);
      }
    }

    if (url.pathname === "/api/orders") {
      return json({
        success: false,
        error: "Admin access is not configured"
      }, 403);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({
        success: false,
        error: "API endpoint not found"
      }, 404);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("HR UNIVERSE", {
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
};
