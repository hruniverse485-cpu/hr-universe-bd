
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    };

    const json = (data, status = 200) => {
      return new Response(JSON.stringify(data), {
        status,
        headers
      });
    };

    // Health Check
    if (url.pathname === "/api/health") {
      if (request.method !== "GET") {
        return json({
          success: false,
          error: "Method not allowed"
        }, 405);
      }

      return json({
        success: true,
        service: "HR UNIVERSE",
        status: "running"
      });
    }

    // Create COD Order
    if (url.pathname === "/api/orders" && request.method === "POST") {
      try {
        if (!env.DB) {
          return json({
            success: false,
            error: "Database connection unavailable"
          }, 503);
        }

        const text = await request.text();

        if (text.length > 20000) {
          return json({
            success: false,
            error: "Request too large"
          }, 413);
        }

        let data;

        try {
          data = JSON.parse(text);
        } catch {
          return json({
            success: false,
            error: "Invalid JSON request"
          }, 400);
        }

        if (!data || typeof data !== "object" || Array.isArray(data)) {
          return json({
            success: false,
            error: "Invalid order information"
          }, 400);
        }

        // Support both nested and flat customer data
        const customer =
          data.customer && typeof data.customer === "object"
            ? data.customer
            : {};

        const productId = String(
          data.product_id || ""
        ).trim();

        const productName = String(
          data.product_name || ""
        ).trim();

        const customerName = String(
          data.customer_name || customer.name || ""
        ).trim();

        const phone = String(
          data.customer_phone || customer.phone || ""
        ).trim();

        const address = String(
          data.customer_address || customer.address || ""
        ).trim();

        const district = String(
          data.district || customer.district || ""
        ).trim();

        const unitPrice = Number(data.unit_price);
        const quantity = Number(data.quantity);

        // Required field validation
        if (
          !productId ||
          !productName ||
          !customerName ||
          !phone ||
          !address ||
          !Number.isSafeInteger(unitPrice) ||
          unitPrice <= 0 ||
          !Number.isSafeInteger(quantity) ||
          quantity < 1 ||
          quantity > 100
        ) {
          return json({
            success: false,
            error: "Please provide valid order information"
          }, 400);
        }

        // Field length validation
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

        // Safe total calculation
        const total = unitPrice * quantity;

        if (!Number.isSafeInteger(total)) {
          return json({
            success: false,
            error: "Invalid order total"
          }, 400);
        }

        const id = crypto.randomUUID();
        const createdAt = new Date().toISOString();

        // Save order in Cloudflare D1
        await env.DB.prepare(`
          INSERT INTO orders (
            id,
            product_id,
            product_name,
            unit_price,
            quantity,
            total,
            payment_method,
            customer_name,
            customer_phone,
            customer_address,
            district,
            status,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          message: "Order received successfully",
          order: {
            id,
            product_id: productId,
            product_name: productName,
            unit_price: unitPrice,
            quantity,
            total,
            payment_method: "COD",
            status: "PENDING",
            created_at: createdAt
          }
        }, 201);

      } catch (error) {
        console.error("HR UNIVERSE Order Error:", error);

        return json({
          success: false,
          error: "Unable to process order. Please try again."
        }, 500);
      }
    }

    // Do not expose orders or customer information publicly
    if (url.pathname === "/api/orders") {
      return json({
        success: false,
        error: "Admin access is not configured"
      }, 403);
    }

    // Unknown API endpoint
    if (url.pathname.startsWith("/api/")) {
      return json({
        success: false,
        error: "API endpoint not found"
      }, 404);
    }

    // Serve website static files
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("HR UNIVERSE", {
      headers: {
        "Content-Type": "text/plain; charset=utf-8"
      }
    });
  }
};
