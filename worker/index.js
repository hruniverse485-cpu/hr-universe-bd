
/**
 * HR UNIVERSE — Cloudflare Worker
 * Compatible with existing orders table and migrations 0002–0008.
 * Database-backed product prices. Browser prices are never trusted.
 * Bangladesh COD only. International checkout remains disabled.
 */

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}

function text(value, max = 200) {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : "";
}

function integer(value, min, max) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max
    ? n
    : null;
}

function minorToMajor(minor, decimals) {
  const factor = 10 ** decimals;

  if (
    !Number.isSafeInteger(minor) ||
    minor % factor !== 0
  ) return null;

  return minor / factor;
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    mismatch |= (left.charCodeAt(i % (left.length || 1)) || 0) ^
      (right.charCodeAt(i % (right.length || 1)) || 0);
  }
  return mismatch === 0;
}

async function compareSupplierOffers(request, env) {
  if (!env.DB) {
    return json({ success: false, error: "Database connection unavailable" }, 503);
  }
  if (!env.HR_ADMIN_API_TOKEN) {
    return json({ success: false, error: "Owner sourcing access is not configured" }, 503);
  }

  const authorization = request.headers.get("Authorization") || "";
  const suppliedToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!constantTimeEqual(suppliedToken, env.HR_ADMIN_API_TOKEN)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  const url = new URL(request.url);
  const productId = text(url.searchParams.get("product_id"), 100);
  const variantId = text(url.searchParams.get("variant_id"), 100);
  const destination = text(url.searchParams.get("destination"), 2).toUpperCase();
  if (!productId || !variantId || !/^[A-Z]{2}$/.test(destination)) {
    return json({
      success: false,
      error: "product_id, variant_id and a two-letter destination country are required"
    }, 400);
  }

  try {
    const result = await env.DB.prepare(`
      SELECT
        svo.id AS offer_id,
        svo.product_id,
        svo.variant_id,
        svo.supplier_variant_id,
        svo.supplier_sku,
        svo.source_unit_cost_minor,
        svo.source_currency_code,
        svo.quality_score,
        svo.service_score,
        svo.packaging_score,
        svo.delivery_score,
        svo.packaging_status,
        svo.supplier_branding_excluded,
        svo.tracking_available,
        svo.returns_supported,
        svo.evidence_reference,
        svo.verified_at,
        svo.expires_at AS offer_expires_at,
        s.id AS supplier_id,
        s.supplier_name,
        s.status AS supplier_status,
        q.id AS shipping_quote_id,
        q.shipping_method_code,
        q.shipping_cost_minor,
        q.currency_code AS destination_currency,
        q.estimated_min_days,
        q.estimated_max_days,
        q.quoted_at,
        q.expires_at AS quote_expires_at,
        q.source_to_destination_fx_numerator,
        q.source_to_destination_fx_denominator,
        q.fx_evidence_reference,
        c.currency_code AS required_destination_currency
      FROM supplier_variant_offers svo
      JOIN supplier_product_sources src ON src.id = svo.source_id
      JOIN suppliers s ON s.id = src.supplier_id
      JOIN supplier_variant_shipping_quotes q ON q.offer_id = svo.id
      JOIN countries c ON c.country_code = q.destination_country_code
      WHERE svo.product_id = ?
        AND svo.variant_id = ?
        AND q.destination_country_code = ?
        AND c.is_active = 1
        AND svo.approval_status = 'ACTIVE'
        AND svo.availability_status = 'AVAILABLE'
        AND src.source_status = 'AVAILABLE'
        AND s.status = 'ACTIVE'
        AND q.availability_status = 'AVAILABLE'
        AND q.currency_code = c.currency_code
        AND q.id = (
          SELECT q2.id
          FROM supplier_variant_shipping_quotes q2
          WHERE q2.offer_id = svo.id
            AND q2.destination_country_code = q.destination_country_code
            AND q2.availability_status = 'AVAILABLE'
            AND datetime(q2.quoted_at) <= CURRENT_TIMESTAMP
            AND (q2.expires_at IS NULL OR datetime(q2.expires_at) > CURRENT_TIMESTAMP)
          ORDER BY datetime(q2.quoted_at) DESC, q2.id DESC
          LIMIT 1
        )
        AND svo.verified_at IS NOT NULL
        AND datetime(svo.verified_at) <= CURRENT_TIMESTAMP
        AND (svo.expires_at IS NULL OR datetime(svo.expires_at) > CURRENT_TIMESTAMP)
        AND datetime(q.quoted_at) <= CURRENT_TIMESTAMP
        AND (q.expires_at IS NULL OR datetime(q.expires_at) > CURRENT_TIMESTAMP)
        AND svo.quality_score IS NOT NULL
        AND svo.service_score IS NOT NULL
        AND svo.packaging_score IS NOT NULL
        AND svo.delivery_score IS NOT NULL
        AND svo.packaging_status IN ('NEUTRAL_CONFIRMED', 'BRANDED_CONFIRMED')
        AND svo.supplier_branding_excluded = 1
        AND (
          svo.source_currency_code = q.currency_code
          OR (
            q.fx_evidence_reference IS NOT NULL
            AND q.source_to_destination_fx_numerator > 0
            AND q.source_to_destination_fx_denominator > 0
          )
        )
      ORDER BY svo.id, q.quoted_at DESC
    `).bind(productId, variantId, destination).all();

    const offers = [];
    for (const row of result.results || []) {
      const convertedProductCost = Math.round(
        Number(row.source_unit_cost_minor) *
        Number(row.source_to_destination_fx_numerator) /
        Number(row.source_to_destination_fx_denominator)
      );
      const shippingCost = Number(row.shipping_cost_minor);
      const landedCost = convertedProductCost + shippingCost;
      if (
        !Number.isSafeInteger(convertedProductCost) ||
        convertedProductCost < 0 ||
        !Number.isSafeInteger(shippingCost) ||
        shippingCost < 0 ||
        !Number.isSafeInteger(landedCost)
      ) continue;

      offers.push({
        offer_id: row.offer_id,
        supplier_id: row.supplier_id,
        supplier_name: row.supplier_name,
        supplier_status: row.supplier_status,
        product_id: row.product_id,
        variant_id: row.variant_id,
        supplier_variant_id: row.supplier_variant_id,
        supplier_sku: row.supplier_sku,
        source_unit_cost_minor: Number(row.source_unit_cost_minor),
        source_currency_code: row.source_currency_code,
        converted_product_cost_minor: convertedProductCost,
        shipping_quote_id: row.shipping_quote_id,
        shipping_method_code: row.shipping_method_code,
        shipping_cost_minor: shippingCost,
        currency_code: row.destination_currency,
        landed_cost_minor: landedCost,
        estimated_min_days: row.estimated_min_days,
        estimated_max_days: row.estimated_max_days,
        packaging_status: row.packaging_status,
        supplier_branding_excluded: Boolean(row.supplier_branding_excluded),
        tracking_available: Boolean(row.tracking_available),
        returns_supported: Boolean(row.returns_supported),
        quality_score: Number(row.quality_score),
        service_score: Number(row.service_score),
        packaging_score: Number(row.packaging_score),
        delivery_score: Number(row.delivery_score),
        evidence_reference: row.evidence_reference,
        fx_evidence_reference: row.fx_evidence_reference,
        verified_at: row.verified_at,
        quote_expires_at: row.quote_expires_at
      });
    }

    if (offers.length === 0) {
      return json({
        success: true,
        product_id: productId,
        variant_id: variantId,
        destination,
        status: "PENDING_VERIFICATION",
        message: "No fully verified, currently valid supplier offer meets the destination and packaging requirements.",
        offers: []
      });
    }

    const minimumCost = Math.min(...offers.map(offer => offer.landed_cost_minor));
    for (const offer of offers) {
      const costScore = minimumCost > 0
        ? Math.min(15, (minimumCost / offer.landed_cost_minor) * 15)
        : 15;
      offer.rank_score = Number((
        offer.quality_score * 0.25 +
        offer.service_score * 0.15 +
        offer.packaging_score * 0.20 +
        offer.delivery_score * 0.15 +
        (offer.tracking_available ? 5 : 0) +
        (offer.returns_supported ? 5 : 0) +
        costScore
      ).toFixed(2));
    }
    offers.sort((a, b) =>
      b.rank_score - a.rank_score ||
      a.landed_cost_minor - b.landed_cost_minor
    );

    return json({
      success: true,
      product_id: productId,
      variant_id: variantId,
      destination,
      currency: offers[0].currency_code,
      ranking_method: "quality 25%, service 15%, packaging 20%, delivery 15%, tracking 5%, returns 5%, landed-cost competitiveness 15%",
      offers
    });
  } catch (error) {
    console.error("Supplier comparison failed:", error);
    return json({ success: false, error: "Unable to compare supplier offers" }, 500);
  }
}


async function manageSupplierOffers(request, env) {
  if (!env.DB) return json({ success: false, error: "Database connection unavailable" }, 503);
  if (!env.HR_ADMIN_API_TOKEN) return json({ success: false, error: "Owner sourcing access is not configured" }, 503);
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!constantTimeEqual(token, env.HR_ADMIN_API_TOKEN)) return json({ success: false, error: "Unauthorized" }, 401);
  if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  let data;
  try {
    const raw = await request.text();
    if (raw.length > 12000) return json({ success: false, error: "Request too large" }, 413);
    data = JSON.parse(raw);
  } catch { return json({ success: false, error: "Invalid JSON request" }, 400); }
  if (!data || typeof data !== "object" || Array.isArray(data)) return json({ success: false, error: "Invalid sourcing operation" }, 400);
  const audit = async (type, id, action, before, after) => env.DB.prepare(
    "INSERT INTO supplier_offer_audit (id,entity_type,entity_id,action,actor,before_json,after_json) VALUES (?,?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), type, id, action, "OWNER_TOKEN", before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null).run();
  try {
    if (data.operation === "save_offer") {
      const id = text(data.id,100) || crypto.randomUUID(), source = text(data.source_id,100);
      const product = text(data.product_id,100), variant = text(data.variant_id,100);
      const external = text(data.supplier_variant_id,160), currency = text(data.source_currency_code,3).toUpperCase();
      const cost = integer(data.source_unit_cost_minor,0,Number.MAX_SAFE_INTEGER);
      const availability = text(data.availability_status || "UNVERIFIED",20).toUpperCase();
      if (!source || !product || !variant || !external || cost === null || !/^[A-Z]{3}$/.test(currency) || !["UNVERIFIED","AVAILABLE","UNAVAILABLE"].includes(availability))
        return json({success:false,error:"Valid source, HR product/variant, supplier variant, cost, currency and availability are required"},400);
      const src = await env.DB.prepare("SELECT src.id,src.source_currency_code FROM supplier_product_sources src WHERE src.id=? AND src.product_id=?").bind(source,product).first();
      const pv = await env.DB.prepare("SELECT id FROM product_variants WHERE id=? AND product_id=?").bind(variant,product).first();
      if (!src || src.source_currency_code !== currency || !pv) return json({success:false,error:"Supplier source, source currency or HR product/variant relationship is invalid"},409);
      const before = await env.DB.prepare("SELECT * FROM supplier_variant_offers WHERE id=?").bind(id).first();
      if (before && (before.source_id!==source || before.product_id!==product || before.variant_id!==variant || before.supplier_variant_id!==external))
        return json({success:false,error:"Offer identity is immutable; create a new offer instead"},409);
      if (before && before.approval_status==="ACTIVE") return json({success:false,error:"Pause an ACTIVE offer before editing it"},409);
      await env.DB.prepare("INSERT INTO supplier_variant_offers (id,source_id,product_id,variant_id,supplier_variant_id,supplier_sku,source_unit_cost_minor,source_currency_code,availability_status,approval_status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'DISCOVERED',CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET supplier_sku=excluded.supplier_sku,source_unit_cost_minor=excluded.source_unit_cost_minor,source_currency_code=excluded.source_currency_code,availability_status=excluded.availability_status,updated_at=CURRENT_TIMESTAMP")
        .bind(id,source,product,variant,external,text(data.supplier_sku,120)||null,cost,currency,availability).run();
      const after = await env.DB.prepare("SELECT * FROM supplier_variant_offers WHERE id=?").bind(id).first();
      await audit("OFFER",id,before?"OFFER_UPDATED":"OFFER_CREATED",before,after);
      return json({success:true,offer:after},before?200:201);
    }

    if (data.operation === "save_quote") {
      const id=text(data.id,100)||crypto.randomUUID(), offerId=text(data.offer_id,100);
      const destination=text(data.destination_country_code,2).toUpperCase();
      const method=text(data.shipping_method_code,40).toUpperCase();
      const cost=integer(data.shipping_cost_minor,0,Number.MAX_SAFE_INTEGER);
      const currency=text(data.currency_code,3).toUpperCase();
      const numerator=integer(data.fx_numerator??1,1,Number.MAX_SAFE_INTEGER);
      const denominator=integer(data.fx_denominator??1,1,Number.MAX_SAFE_INTEGER);
      const quotedAt=text(data.quoted_at,40), expiresAt=data.expires_at==null?null:text(data.expires_at,40);
      const minDays=data.estimated_min_days==null?null:integer(data.estimated_min_days,0,3650);
      const maxDays=data.estimated_max_days==null?null:integer(data.estimated_max_days,0,3650);
      const fxEvidence=text(data.fx_evidence_reference,500)||null;
      if(!offerId||!/^[A-Z]{2}$/.test(destination)||!/^[A-Z0-9_-]{2,40}$/.test(method)||cost===null||!/^[A-Z]{3}$/.test(currency)||numerator===null||denominator===null||!quotedAt||(data.estimated_min_days!=null&&minDays===null)||(data.estimated_max_days!=null&&maxDays===null)||(minDays!==null&&maxDays!==null&&minDays>maxDays))
        return json({success:false,error:"Invalid shipping quote fields"},400);
      const offer=await env.DB.prepare("SELECT o.id,o.source_currency_code,c.currency_code AS destination_currency FROM supplier_variant_offers o JOIN countries c ON c.country_code=? AND c.is_active=1 WHERE o.id=?").bind(destination,offerId).first();
      if(!offer||offer.destination_currency!==currency)return json({success:false,error:"Offer, active destination or destination currency is invalid"},409);
      if(offer.source_currency_code!==currency&&!fxEvidence)return json({success:false,error:"Cross-currency quotes require FX evidence"},400);
      const before=await env.DB.prepare("SELECT * FROM supplier_variant_shipping_quotes WHERE id=?").bind(id).first();
      await env.DB.prepare("INSERT INTO supplier_variant_shipping_quotes (id,offer_id,destination_country_code,shipping_method_code,shipping_cost_minor,currency_code,estimated_min_days,estimated_max_days,availability_status,source_to_destination_fx_numerator,source_to_destination_fx_denominator,fx_evidence_reference,quoted_at,expires_at) VALUES (?,?,?,?,?,?,?,?,'AVAILABLE',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET shipping_method_code=excluded.shipping_method_code,shipping_cost_minor=excluded.shipping_cost_minor,currency_code=excluded.currency_code,estimated_min_days=excluded.estimated_min_days,estimated_max_days=excluded.estimated_max_days,availability_status='AVAILABLE',source_to_destination_fx_numerator=excluded.source_to_destination_fx_numerator,source_to_destination_fx_denominator=excluded.source_to_destination_fx_denominator,fx_evidence_reference=excluded.fx_evidence_reference,quoted_at=excluded.quoted_at,expires_at=excluded.expires_at")
        .bind(id,offerId,destination,method,cost,currency,minDays,maxDays,numerator,denominator,fxEvidence,quotedAt,expiresAt).run();
      const after=await env.DB.prepare("SELECT * FROM supplier_variant_shipping_quotes WHERE id=?").bind(id).first();
      await audit("SHIPPING_QUOTE",id,before?"QUOTE_UPDATED":"QUOTE_CREATED",before,after);
      return json({success:true,quote:after},before?200:201);
    }
    if (data.operation === "verify_offer") {
      const id=text(data.offer_id,100);
      const score=value=>integer(value,0,100);
      const quality=score(data.quality_score), service=score(data.service_score), packaging=score(data.packaging_score), delivery=score(data.delivery_score);
      const packageStatus=text(data.packaging_status,30).toUpperCase();
      const evidence=text(data.evidence_reference,500);
      if(!id||quality===null||service===null||packaging===null||delivery===null||!["NEUTRAL_CONFIRMED","BRANDED_CONFIRMED","FAILED"].includes(packageStatus)||!evidence)
        return json({success:false,error:"Four 0–100 scores, packaging verification and evidence reference are required"},400);
      const before=await env.DB.prepare("SELECT * FROM supplier_variant_offers WHERE id=?").bind(id).first();
      if(!before)return json({success:false,error:"Supplier offer not found"},404);
      if(before.approval_status==="ACTIVE")return json({success:false,error:"Pause an ACTIVE offer before changing verification"},409);
      await env.DB.prepare("UPDATE supplier_variant_offers SET quality_score=?,service_score=?,packaging_score=?,delivery_score=?,packaging_status=?,supplier_branding_excluded=?,tracking_available=?,returns_supported=?,evidence_reference=?,verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(quality,service,packaging,delivery,packageStatus,data.supplier_branding_excluded===true?1:0,data.tracking_available===true?1:0,data.returns_supported===true?1:0,evidence,id).run();
      const after=await env.DB.prepare("SELECT * FROM supplier_variant_offers WHERE id=?").bind(id).first();
      await audit("OFFER",id,"OFFER_VERIFIED",before,after);
      return json({success:true,offer:after});
    }
\n    if (data.operation === "transition") {
      const id=text(data.offer_id,100), target=text(data.approval_status,30).toUpperCase();
      if (!id || !["TERMS_REVIEW","SAMPLE_REQUIRED","QUALITY_APPROVED","DESTINATION_APPROVED","ACTIVE","PAUSED","REJECTED"].includes(target))
        return json({success:false,error:"Invalid offer transition"},400);
      const before=await env.DB.prepare("SELECT o.*,src.source_status,s.status AS supplier_status FROM supplier_variant_offers o JOIN supplier_product_sources src ON src.id=o.source_id JOIN suppliers s ON s.id=src.supplier_id WHERE o.id=?").bind(id).first();
      if (!before) return json({success:false,error:"Supplier offer not found"},404);
      if (target==="DESTINATION_APPROVED" || target==="ACTIVE") {
        const quote=await env.DB.prepare("SELECT q.id FROM supplier_variant_shipping_quotes q JOIN countries c ON c.country_code=q.destination_country_code AND c.is_active=1 WHERE q.offer_id=? AND q.availability_status='AVAILABLE' AND q.currency_code=c.currency_code AND datetime(q.quoted_at)<=CURRENT_TIMESTAMP AND (q.expires_at IS NULL OR datetime(q.expires_at)>CURRENT_TIMESTAMP) AND (q.currency_code=? OR (q.fx_evidence_reference IS NOT NULL AND q.source_to_destination_fx_numerator>0 AND q.source_to_destination_fx_denominator>0)) LIMIT 1").bind(id,before.source_currency_code).first();
        if (!quote) return json({success:false,error:"A current destination-valid shipping quote and FX evidence are required"},409);
      }
      if (target==="ACTIVE" && (before.supplier_status!=="ACTIVE" || before.source_status!=="AVAILABLE" || before.availability_status!=="AVAILABLE" || !before.evidence_reference || !before.verified_at || before.quality_score==null || before.service_score==null || before.packaging_score==null || before.delivery_score==null || !["NEUTRAL_CONFIRMED","BRANDED_CONFIRMED"].includes(before.packaging_status) || Number(before.supplier_branding_excluded)!==1))
        return json({success:false,error:"ACTIVE requires an active supplier/source, available stock, verification evidence, all quality scores and confirmed supplier-branding-free packaging"},409);
      await env.DB.prepare("UPDATE supplier_variant_offers SET approval_status=?,updated_at=CURRENT_TIMESTAMP,verified_at=CASE WHEN ?='ACTIVE' THEN COALESCE(verified_at,CURRENT_TIMESTAMP) ELSE verified_at END WHERE id=?").bind(target,target,id).run();
      const after=await env.DB.prepare("SELECT * FROM supplier_variant_offers WHERE id=?").bind(id).first();
      await audit("OFFER",id,"STATUS_"+target,before,after);
      return json({success:true,offer:after});
    }
    return json({success:false,error:"operation must be save_offer, save_quote, verify_offer or transition"},400);
  } catch(error) {
    console.error("Supplier offer management failed:",error);
    return json({success:false,error:"Unable to save supplier offer operation"},500);
  }
}

async function health(env) {
  if (!env.DB) {
    return json({
      success: false,
      error: "Database connection unavailable"
    }, 503);
  }

  try {
    await env.DB.prepare("SELECT 1 AS ok").first();

    return json({
      success: true,
      service: "HR UNIVERSE",
      status: "running",
      database: "connected"
    });
  } catch (error) {
    console.error("Health check failed:", error);

    return json({
      success: false,
      service: "HR UNIVERSE",
      status: "degraded",
      database: "unavailable"
    }, 503);
  }
}

async function listProducts(request, env) {
  if (!env.DB) {
    return json({
      success: false,
      error: "Database connection unavailable"
    }, 503);
  }

  const url = new URL(request.url);

  const country = text(
    url.searchParams.get("country"), 10
  ).toUpperCase();

  const currency = text(
    url.searchParams.get("currency"), 10
  ).toUpperCase();

  const q = text(url.searchParams.get("q"), 80);

  const limitRaw = Number.parseInt(
    url.searchParams.get("limit") || "24", 10
  );

  const limit = Number.isSafeInteger(limitRaw)
    ? Math.min(50, Math.max(1, limitRaw))
    : 24;

  if (
    !/^[A-Z]{2}$/.test(country) ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    return json({
      success: false,
      error: "Valid country and currency are required"
    }, 400);
  }

  try {
    const result = await env.DB.prepare(`
      SELECT
        p.id AS product_id,
        p.name,
        p.slug,
        p.description,
        p.brand,

        c.id AS category_id,
        c.name AS category_name,

        pp.price_minor,
        pp.compare_at_price_minor,
        pp.currency_code,

        cur.symbol AS currency_symbol,
        cur.decimal_places,

        (
          SELECT pi.image_url
          FROM product_images pi
          WHERE pi.product_id = p.id
          ORDER BY pi.sort_order ASC
          LIMIT 1
        ) AS image_url

      FROM products p

      JOIN categories c
        ON c.id = p.category_id
       AND c.is_active = 1

      JOIN product_prices pp
        ON pp.product_id = p.id
       AND pp.variant_id IS NULL
       AND pp.country_code = ?
       AND pp.currency_code = ?
       AND pp.status = 'ACTIVE'
       AND (
         pp.valid_from IS NULL
         OR datetime(pp.valid_from) <= CURRENT_TIMESTAMP
       )
       AND (
         pp.valid_until IS NULL
         OR datetime(pp.valid_until) > CURRENT_TIMESTAMP
       )

      JOIN countries co
        ON co.country_code = pp.country_code
       AND co.is_active = 1

      JOIN currencies cur
        ON cur.code = pp.currency_code
       AND cur.is_active = 1

      WHERE p.status = 'ACTIVE'
        AND (
          ? = ''
          OR p.name LIKE '%' || ? || '%'
          OR p.description LIKE '%' || ? || '%'
        )

      ORDER BY p.created_at DESC
      LIMIT ?
    `).bind(
      country,
      currency,
      q,
      q,
      q,
      limit
    ).all();

    return json({
      success: true,
      country,
      currency,
      count: result.results.length,
      products: result.results
    });

  } catch (error) {
    console.error("Product listing failed:", error);

    return json({
      success: false,
      error: "Unable to load products"
    }, 500);
  }
}

async function createCodOrder(request, env) {
  if (!env.DB) {
    return json({
      success: false,
      error: "Database connection unavailable"
    }, 503);
  }

  let raw;

  try {
    raw = await request.text();
  } catch {
    return json({
      success: false,
      error: "Unable to read request"
    }, 400);
  }

  if (raw.length > 20000) {
    return json({
      success: false,
      error: "Request too large"
    }, 413);
  }

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    return json({
      success: false,
      error: "Invalid JSON request"
    }, 400);
  }

  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data)
  ) {
    return json({
      success: false,
      error: "Invalid order information"
    }, 400);
  }

  const country = text(
    data.country_code || "BD", 2
  ).toUpperCase();

  const currency = text(
    data.currency_code || "BDT", 3
  ).toUpperCase();

  const paymentMethod = text(
    data.payment_method || "COD", 20
  ).toUpperCase();

  if (
    country !== "BD" ||
    currency !== "BDT" ||
    paymentMethod !== "COD"
  ) {
    return json({
      success: false,
      error: "Only Bangladesh BDT Cash on Delivery is currently supported"
    }, 400);
  }

  const idempotencyKey = text(
    request.headers.get("Idempotency-Key") ||
    data.idempotency_key,
    100
  );

  if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,100}$/.test(idempotencyKey)) {
    return json({
      success: false,
      error: "A valid Idempotency-Key header or idempotency_key is required"
    }, 400);
  }

  try {
    const existing = await env.DB.prepare(`
      SELECT id, status, created_at
      FROM orders
      WHERE idempotency_key = ?
    `).bind(idempotencyKey).first();

    if (existing) {
      return json({
        success: true,
        duplicate: true,
        message: "This order request was already received",
        order: existing
      });
    }
  } catch (error) {
    console.error("Idempotency lookup failed:", error);
    return json({
      success: false,
      error: "Unable to verify whether this order was already received"
    }, 503);
  }

  const customer =
    data.customer && typeof data.customer === "object"
      ? data.customer
      : {};

  const customerName = text(
    data.customer_name || customer.name, 120
  );

  const phone = text(
    data.customer_phone || customer.phone, 30
  );

  const address = text(
    data.customer_address || customer.address, 1000
  );

  const district = text(
    data.district || customer.district, 100
  );

  if (
    !customerName ||
    !phone ||
    !address ||
    !district
  ) {
    return json({
      success: false,
      error: "Name, phone, full address and district are required"
    }, 400);
  }

  let requestedItems;

  if (Array.isArray(data.items)) {
    if (
      data.items.length < 1 ||
      data.items.length > 20
    ) {
      return json({
        success: false,
        error: "Order must contain 1 to 20 items"
      }, 400);
    }

    requestedItems = data.items;
  } else {
    requestedItems = [{
      product_id: data.product_id,
      variant_id: data.variant_id,
      quantity: data.quantity
    }];
  }

  const normalized = [];

  for (const item of requestedItems) {
    const productId = text(
      item && item.product_id, 100
    );

    const variantId = text(
      item && item.variant_id, 100
    ) || null;

    const quantity = integer(
      item && item.quantity, 1, 100
    );

    if (!productId || quantity === null) {
      return json({
        success: false,
        error: "Each item needs a valid product_id and quantity"
      }, 400);
    }

    normalized.push({
      productId,
      variantId,
      quantity
    });
  }

  try {
    const countryRow = await env.DB.prepare(`
      SELECT country_code
      FROM countries
      WHERE country_code = 'BD'
        AND is_active = 1
    `).first();

    const currencyRow = await env.DB.prepare(`
      SELECT code, decimal_places
      FROM currencies
      WHERE code = 'BDT'
        AND is_active = 1
    `).first();

    if (!countryRow || !currencyRow) {
      return json({
        success: false,
        error: "Bangladesh COD market is not activated in Admin setup"
      }, 409);
    }

    const decimals = Number(
      currencyRow.decimal_places
    );

    if (
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > 4
    ) {
      return json({
        success: false,
        error: "Currency configuration is invalid"
      }, 500);
    }

    const pricedItems = [];
    let subtotalMinor = 0;

    for (const item of normalized) {
      if (item.variantId) {
        const variant = await env.DB.prepare(`
          SELECT id
          FROM product_variants
          WHERE id = ?
            AND product_id = ?
            AND status = 'ACTIVE'
        `).bind(
          item.variantId,
          item.productId
        ).first();

        if (!variant) {
          return json({
            success: false,
            error: "One or more selected variants are unavailable"
          }, 409);
        }
      }

      const product = await env.DB.prepare(`
        SELECT
          p.id,
          p.name,
          pp.price_minor,
          pp.currency_code,
          pp.variant_id AS priced_variant_id,
          pv.sku

        FROM products p

        JOIN categories c
          ON c.id = p.category_id
         AND c.is_active = 1

        JOIN product_prices pp
          ON pp.product_id = p.id
         AND pp.country_code = 'BD'
         AND pp.currency_code = 'BDT'
         AND pp.status = 'ACTIVE'
         AND (
           pp.valid_from IS NULL
           OR datetime(pp.valid_from) <= CURRENT_TIMESTAMP
         )
         AND (
           pp.valid_until IS NULL
           OR datetime(pp.valid_until) > CURRENT_TIMESTAMP
         )

        LEFT JOIN product_variants pv
          ON pv.id = ?
         AND pv.product_id = p.id
         AND pv.status = 'ACTIVE'

        WHERE p.id = ?
          AND p.status = 'ACTIVE'
          AND (
            (? IS NULL AND pp.variant_id IS NULL)
            OR
            (
              ? IS NOT NULL
              AND (
                pp.variant_id = ?
                OR pp.variant_id IS NULL
              )
            )
          )

        ORDER BY
          CASE WHEN pp.variant_id = ? THEN 0 ELSE 1 END

        LIMIT 1
      `).bind(
        item.variantId,
        item.productId,
        item.variantId,
        item.variantId,
        item.variantId,
        item.variantId
      ).first();

      if (!product) {
        return json({
          success: false,
          error: "One or more products are unavailable for Bangladesh checkout"
        }, 409);
      }

      const priceMinor = Number(product.price_minor);

      const lineTotalMinor =
        priceMinor * item.quantity;

      if (
        !Number.isSafeInteger(priceMinor) ||
        priceMinor <= 0 ||
        !Number.isSafeInteger(lineTotalMinor)
      ) {
        return json({
          success: false,
          error: "Invalid product price configuration"
        }, 500);
      }

      // The order_items INSERT trigger performs the authoritative atomic
      // reservation inside the same D1 batch as the order write. This
      // preflight check is only a friendly early response, not the lock.
      if (!item.variantId) {
        return json({
          success: false,
          error: `A verified active variant is required for ${product.name}`
        }, 409);
      }

      const stock = await env.DB.prepare(`
        SELECT i.id
        FROM inventory i
        JOIN warehouses w ON w.id = i.warehouse_id
        WHERE i.product_id = ?
          AND i.variant_id = ?
          AND w.country_code = 'BD'
          AND w.status = 'ACTIVE'
          AND i.verified_at IS NOT NULL
          AND i.quantity >= ?
        ORDER BY i.id
        LIMIT 1
      `).bind(
        item.productId,
        item.variantId,
        item.quantity
      ).first();

      if (!stock) {
        return json({
          success: false,
          error: `Insufficient verified Bangladesh warehouse stock for ${product.name}`
        }, 409);
      }

      subtotalMinor += lineTotalMinor;

      if (!Number.isSafeInteger(subtotalMinor)) {
        return json({
          success: false,
          error: "Order total is too large"
        }, 400);
      }

      pricedItems.push({
        ...item,
        name: product.name,
        sku: product.sku || null,
        priceMinor,
        lineTotalMinor
      });
    }

    const shipping = await env.DB.prepare(`
      SELECT sr.base_cost_minor

      FROM shipping_rates sr

      JOIN shipping_methods sm
        ON sm.id = sr.shipping_method_id

      WHERE sr.country_code = 'BD'
        AND sr.currency_code = 'BDT'
        AND sr.status = 'ACTIVE'
        AND sm.status = 'ACTIVE'
        AND sm.fulfillment_type = 'LOCAL_WAREHOUSE'

      ORDER BY sr.base_cost_minor ASC
      LIMIT 1
    `).first();

    if (!shipping) {
      return json({
        success: false,
        error: "Bangladesh local shipping rate is not configured; order was not created"
      }, 409);
    }

    const shippingMinor = Number(
      shipping.base_cost_minor
    );

    const totalMinor =
      subtotalMinor + shippingMinor;

    if (
      !Number.isSafeInteger(shippingMinor) ||
      shippingMinor < 0 ||
      !Number.isSafeInteger(totalMinor)
    ) {
      return json({
        success: false,
        error: "Shipping or order total configuration is invalid"
      }, 500);
    }

    const first = pricedItems[0];
    const isSingleItem = pricedItems.length === 1;

    const legacyUnitPrice = minorToMajor(
      isSingleItem ? first.priceMinor : totalMinor,
      decimals
    );

    const legacyTotal = minorToMajor(
      totalMinor,
      decimals
    );

    if (
      legacyUnitPrice === null ||
      legacyTotal === null ||
      minorToMajor(shippingMinor, decimals) === null
    ) {
      return json({
        success: false,
        error: "Prices must use whole BDT amounts while legacy order compatibility is active"
      }, 409);
    }

    const orderId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const statements = [
      env.DB.prepare(`
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
          created_at,
          country_code,
          currency_code,
          subtotal_minor,
          shipping_cost_minor,
          tax_minor,
          total_minor,
          fulfillment_type,
          idempotency_key
        )
        VALUES (
          ?, ?, ?, ?, ?, ?,
          'COD', ?, ?, ?, ?,
          'PENDING', ?, 'BD', 'BDT',
          ?, ?, 0, ?,
          'LOCAL_WAREHOUSE', ?
        )
      `).bind(
        orderId,
        isSingleItem ? first.productId : "MULTI",
        isSingleItem
          ? first.name
          : `Order with ${pricedItems.length} items`,
        legacyUnitPrice,
        isSingleItem
          ? first.quantity
          : 1,
        legacyTotal,
        customerName,
        phone,
        address,
        district,
        createdAt,
        subtotalMinor,
        shippingMinor,
        totalMinor,
        idempotencyKey
      )
    ];

    for (const item of pricedItems) {
      statements.push(env.DB.prepare(`
        INSERT INTO order_items (
          id,
          order_id,
          product_id,
          variant_id,
          product_name_snapshot,
          sku_snapshot,
          unit_price_minor,
          currency_code,
          quantity,
          line_total_minor,
          fulfillment_type,
          created_at
        )
        VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          'BDT', ?, ?,
          'LOCAL_WAREHOUSE', ?
        )
      `).bind(
        crypto.randomUUID(),
        orderId,
        item.productId,
        item.variantId,
        item.name,
        item.sku,
        item.priceMinor,
        item.quantity,
        item.lineTotalMinor,
        createdAt
      ));
    }

    try {
      await env.DB.batch(statements);
    } catch (error) {
      const databaseMessage = String(error && error.message || "");

      if (databaseMessage.includes("Insufficient verified stock for atomic reservation")) {
        return json({
          success: false,
          error: "Stock changed while placing the order. Please review availability and try again."
        }, 409);
      }

      if (
        databaseMessage
          .toLowerCase()
          .includes("unique")
      ) {
        const existing = await env.DB.prepare(`
          SELECT id, status, created_at
          FROM orders
          WHERE idempotency_key = ?
        `).bind(idempotencyKey).first();

        if (existing) {
          return json({
            success: true,
            duplicate: true,
            message: "This order request was already received",
            order: existing
          });
        }
      }

      throw error;
    }

    return json({
      success: true,
      message: "COD order received. Our team will confirm it.",
      order: {
        id: orderId,
        status: "PENDING",
        payment_method: "COD",
        country_code: "BD",
        currency_code: "BDT",
        item_count: pricedItems.length,
        subtotal_minor: subtotalMinor,
        shipping_cost_minor: shippingMinor,
        tax_minor: 0,
        total_minor: totalMinor,
        created_at: createdAt
      }
    }, 201);

  } catch (error) {
    console.error("HR UNIVERSE Order API Error:", error);

    return json({
      success: false,
      error: "Unable to process order. Please try again."
    }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/health") {
      if (request.method !== "GET") {
        return json({
          success: false,
          error: "Method not allowed"
        }, 405);
      }

      return health(env);
    }

    if (path === "/api/admin/sourcing/offers") return manageSupplierOffers(request, env);

    if (path === "/api/admin/sourcing/compare") {
      if (request.method !== "GET") {
        return json({ success: false, error: "Method not allowed" }, 405);
      }
      return compareSupplierOffers(request, env);
    }

    if (path === "/api/products") {
      if (request.method !== "GET") {
        return json({
          success: false,
          error: "Method not allowed"
        }, 405);
      }

      return listProducts(request, env);
    }

    if (
      path === "/api/orders" &&
      request.method === "POST"
    ) {
      return createCodOrder(request, env);
    }

    if (path === "/api/orders") {
      return json({
        success: false,
        error: "Admin access is not configured"
      }, 403);
    }

    if (path.startsWith("/api/")) {
      return json({
        success: false,
        error: "API endpoint not found"
      }, 404);
    }

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
