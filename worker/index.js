
/**
 * HR UNIVERSE — Cloudflare Worker
 * Compatible with existing orders table and migrations 0002–0009.
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

function convertMinorByRatio(minorValue, numeratorValue, denominatorValue) {
  const minor = integer(minorValue, 0, Number.MAX_SAFE_INTEGER);
  const numerator = integer(numeratorValue, 1, Number.MAX_SAFE_INTEGER);
  const denominator = integer(denominatorValue, 1, Number.MAX_SAFE_INTEGER);
  if (minor === null || numerator === null || denominator === null) return null;

  // BigInt keeps the multiplication and half-up rounding exact even when
  // the intermediate product exceeds Number.MAX_SAFE_INTEGER.
  const product = BigInt(minor) * BigInt(numerator);
  const divisor = BigInt(denominator);
  const rounded = (product + divisor / 2n) / divisor;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(rounded);
}

function publicCatalogImageUrl(value, requestUrl) {
  const raw = text(value, 2048);
  if (!raw) return null;

  try {
    const requestOrigin = new URL(requestUrl).origin;
    const parsed = new URL(raw, requestOrigin + "/");
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== requestOrigin ||
      parsed.username ||
      parsed.password ||
      parsed.pathname.startsWith("/api/")
    ) {
      return null;
    }

    // Public catalog responses must not disclose third-party supplier/CDN
    // hostnames or signed query strings. Keep only a same-origin path.
    return parsed.pathname;
  } catch {
    return null;
  }
}

function canonicalizeForHash(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeForHash);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => key !== "idempotency_key")
        .sort()
        .map((key) => [key, canonicalizeForHash(value[key])])
    );
  }
  return value;
}

async function orderRequestFingerprint(data) {
  const canonical = JSON.stringify(canonicalizeForHash(data));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
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
      const convertedProductCost = convertMinorByRatio(
        row.source_unit_cost_minor,
        row.source_to_destination_fx_numerator,
        row.source_to_destination_fx_denominator
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
  if (request.method === "GET") {
    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    if (url.searchParams.get("view") === "audit") {
      const entityId = text(url.searchParams.get("entity_id"), 100);
      if (!entityId) return json({ success: false, error: "entity_id is required for audit view" }, 400);
      const rows = await env.DB.prepare("SELECT entity_type, entity_id, action, actor, before_json, after_json, created_at FROM supplier_offer_audit WHERE entity_id = ? ORDER BY created_at DESC LIMIT ?").bind(entityId, limit).all();
      return json({ success: true, audit: rows.results || [] });
    }
    const rows = await env.DB.prepare("SELECT o.*, src.source_status, s.name AS supplier_name FROM supplier_variant_offers o JOIN supplier_product_sources src ON src.id=o.source_id JOIN suppliers s ON s.id=src.supplier_id ORDER BY o.updated_at DESC, o.created_at DESC LIMIT ?").bind(limit).all();
    return json({ success: true, offers: rows.results || [] });
  }
  if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  let data;
  try {
    const raw = await request.text();
    if (raw.length > 12000) return json({ success: false, error: "Request too large" }, 413);
    data = JSON.parse(raw);
  } catch { return json({ success: false, error: "Invalid JSON request" }, 400); }
  if (!data || typeof data !== "object" || Array.isArray(data)) return json({ success: false, error: "Invalid sourcing operation" }, 400);
  const commitAudited = async (mutation, type, id, action, before, table, fields) => {
    // D1 batch is transactional: the business mutation and its audit snapshot
    // either both commit or both roll back.
    const afterJson = "json_object(" + fields.map(field => "'" + field + "', " + field).join(",") + ")";
    const auditStatement = env.DB.prepare(
      "INSERT INTO supplier_offer_audit (id,entity_type,entity_id,action,actor,before_json,after_json) " +
      "SELECT ?,?,?,?,?,?," + afterJson + " FROM " + table + " WHERE id=?"
    ).bind(
      crypto.randomUUID(), type, id, action, "OWNER_TOKEN",
      before ? JSON.stringify(before) : null, id
    );
    await env.DB.batch([mutation, auditStatement]);
  };
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
      const mutation = env.DB.prepare("INSERT INTO supplier_variant_offers (id,source_id,product_id,variant_id,supplier_variant_id,supplier_sku,source_unit_cost_minor,source_currency_code,availability_status,approval_status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'DISCOVERED',CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET supplier_sku=excluded.supplier_sku,source_unit_cost_minor=excluded.source_unit_cost_minor,source_currency_code=excluded.source_currency_code,availability_status=excluded.availability_status,updated_at=CURRENT_TIMESTAMP")
        .bind(id,source,product,variant,external,text(data.supplier_sku,120)||null,cost,currency,availability);
      await commitAudited(mutation,"OFFER",id,before?"OFFER_UPDATED":"OFFER_CREATED",before,"supplier_variant_offers",["id","source_id","product_id","variant_id","supplier_variant_id","supplier_sku","source_unit_cost_minor","source_currency_code","availability_status","approval_status","quality_score","service_score","packaging_score","delivery_score","packaging_status","supplier_branding_excluded","tracking_available","returns_supported","evidence_reference","verified_at","expires_at","created_at","updated_at"]);
      const after = await env.DB.prepare("SELECT * FROM supplier_variant_offers WHERE id=?").bind(id).first();
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
      if (before && (before.offer_id !== offerId || before.destination_country_code !== destination)) {
        return json({success:false,error:"Shipping quote identity is immutable; create a new quote instead"},409);
      }
      const mutation = env.DB.prepare("INSERT INTO supplier_variant_shipping_quotes (id,offer_id,destination_country_code,shipping_method_code,shipping_cost_minor,currency_code,estimated_min_days,estimated_max_days,availability_status,source_to_destination_fx_numerator,source_to_destination_fx_denominator,fx_evidence_reference,quoted_at,expires_at) VALUES (?,?,?,?,?,?,?,?,'AVAILABLE',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET shipping_method_code=excluded.shipping_method_code,shipping_cost_minor=excluded.shipping_cost_minor,currency_code=excluded.currency_code,estimated_min_days=excluded.estimated_min_days,estimated_max_days=excluded.estimated_max_days,availability_status='AVAILABLE',source_to_destination_fx_numerator=excluded.source_to_destination_fx_numerator,source_to_destination_fx_denominator=excluded.source_to_destination_fx_denominator,fx_evidence_reference=excluded.fx_evidence_reference,quoted_at=excluded.quoted_at,expires_at=excluded.expires_at")
        .bind(id,offerId,destination,method,cost,currency,minDays,maxDays,numerator,denominator,fxEvidence,quotedAt,expiresAt);
      await commitAudited(mutation,"SHIPPING_QUOTE",id,before?"QUOTE_UPDATED":"QUOTE_CREATED",before,"supplier_variant_shipping_quotes",["id","offer_id","destination_country_code","shipping_method_code","shipping_cost_minor","currency_code","estimated_min_days","estimated_max_days","availability_status","source_to_destination_fx_numerator","source_to_destination_fx_denominator","fx_evidence_reference","quoted_at","expires_at","created_at"]);
      const after=await env.DB.prepare("SELECT * FROM supplier_variant_shipping_quotes WHERE id=?").bind(id).first();
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
      const mutation = env.DB.prepare("UPDATE supplier_variant_offers SET quality_score=?,service_score=?,packaging_score=?,delivery_score=?,packaging_status=?,supplier_branding_excluded=?,tracking_available=?,returns_supported=?,evidence_reference=?,verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(quality,service,packaging,delivery,packageStatus,data.supplier_branding_excluded===true?1:0,data.tracking_available===true?1:0,data.returns_supported===true?1:0,evidence,id);
      await commitAudited(mutation,"OFFER",id,"OFFER_VERIFIED",before,"supplier_variant_offers",["id","source_id","product_id","variant_id","supplier_variant_id","supplier_sku","source_unit_cost_minor","source_currency_code","availability_status","approval_status","quality_score","service_score","packaging_score","delivery_score","packaging_status","supplier_branding_excluded","tracking_available","returns_supported","evidence_reference","verified_at","expires_at","created_at","updated_at"]);
      const after=await env.DB.prepare("SELECT * FROM supplier_variant_offers WHERE id=?").bind(id).first();
      return json({success:true,offer:after});
    }

    if (data.operation === "transition") {
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
      const mutation = env.DB.prepare("UPDATE supplier_variant_offers SET approval_status=?,updated_at=CURRENT_TIMESTAMP,verified_at=CASE WHEN ?='ACTIVE' THEN COALESCE(verified_at,CURRENT_TIMESTAMP) ELSE verified_at END WHERE id=?").bind(target,target,id);
      await commitAudited(mutation,"OFFER",id,"STATUS_"+target,before,"supplier_variant_offers",["id","source_id","product_id","variant_id","supplier_variant_id","supplier_sku","source_unit_cost_minor","source_currency_code","availability_status","approval_status","quality_score","service_score","packaging_score","delivery_score","packaging_status","supplier_branding_excluded","tracking_available","returns_supported","evidence_reference","verified_at","expires_at","created_at","updated_at"]);
      const after=await env.DB.prepare("SELECT * FROM supplier_variant_offers WHERE id=?").bind(id).first();
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
  const cursorCreatedAt = text(url.searchParams.get("cursor_created_at"), 40);
  const cursorId = text(url.searchParams.get("cursor_id"), 100);
  if (Boolean(cursorCreatedAt) !== Boolean(cursorId)) {
    return json({ success: false, error: "Both cursor_created_at and cursor_id are required together" }, 400);
  }
  if (cursorCreatedAt && (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z)?$/.test(cursorCreatedAt) || !/^[A-Za-z0-9_-]{1,100}$/.test(cursorId))) {
    return json({ success: false, error: "Invalid product catalog cursor" }, 400);
  }
  const inventoryMaxAgeHours = integer(env.HR_INVENTORY_MAX_AGE_HOURS, 1, 72) || 72;
  const inventoryMaxAgeModifier = `-${inventoryMaxAgeHours} hours`;

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
        p.created_at AS catalog_cursor_created_at,

        c.id AS category_id,
        c.name AS category_name,
        c.slug AS category_slug,

        pp.price_minor,
        pp.compare_at_price_minor,
        pp.currency_code,

        cur.symbol AS currency_symbol,
        cur.decimal_places,
        'LOCAL_WAREHOUSE' AS fulfillment_type,

        (
          SELECT COALESCE(MAX(i.quantity), 0)
          FROM product_variants pv
          JOIN inventory i ON i.product_id = p.id AND i.variant_id = pv.id
          JOIN warehouses w ON w.id = i.warehouse_id
          WHERE pv.product_id = p.id AND pv.status = 'ACTIVE'
            AND w.country_code = co.country_code AND w.status = 'ACTIVE'
            AND i.verified_at IS NOT NULL
            AND datetime(i.verified_at) >= datetime('now', ?)
            AND datetime(i.verified_at) <= CURRENT_TIMESTAMP
            AND i.quantity > 0
        ) AS available_quantity,

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
        AND EXISTS (
          SELECT 1
          FROM product_variants pv
          JOIN inventory i ON i.product_id = p.id AND i.variant_id = pv.id
          JOIN warehouses w ON w.id = i.warehouse_id
          WHERE pv.product_id = p.id AND pv.status = 'ACTIVE'
            AND w.country_code = co.country_code AND w.status = 'ACTIVE'
            AND i.verified_at IS NOT NULL
            AND datetime(i.verified_at) >= datetime('now', ?)
            AND datetime(i.verified_at) <= CURRENT_TIMESTAMP
            AND i.quantity > 0
        )
        AND (
          ? = ''
          OR p.name LIKE '%' || ? || '%'
          OR p.description LIKE '%' || ? || '%'
        )
        AND (
          ? = ''
          OR p.created_at < ?
          OR (p.created_at = ? AND p.id < ?)
        )

      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ?
    `).bind(
      inventoryMaxAgeModifier,
      country,
      currency,
      inventoryMaxAgeModifier,
      q,
      q,
      q,
      cursorCreatedAt,
      cursorCreatedAt,
      cursorCreatedAt,
      cursorId,
      limit + 1
    ).all();

    const rows = result.results || [];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    return json({
      success: true,
      country,
      currency,
      inventory_max_age_hours: inventoryMaxAgeHours,
      count: pageRows.length,
      has_more: hasMore,
      next_cursor: hasMore && lastRow?.catalog_cursor_created_at && lastRow?.product_id
        ? { created_at: lastRow.catalog_cursor_created_at, id: lastRow.product_id }
        : null,
      products: pageRows.map(({ catalog_cursor_created_at, ...product }) => ({
        ...product,
        image_url: publicCatalogImageUrl(product.image_url, request.url)
      }))
    });

  } catch (error) {
    console.error("Product listing failed:", error);

    return json({
      success: false,
      error: "Unable to load products"
    }, 500);
  }
}

async function listCategories(request, env) {
  if (!env.DB) return json({ success: false, error: "Database connection unavailable" }, 503);
  const url = new URL(request.url);
  const country = text(url.searchParams.get("country"), 10).toUpperCase();
  const currency = text(url.searchParams.get("currency"), 10).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z]{3}$/.test(currency)) {
    return json({ success: false, error: "Valid country and currency are required" }, 400);
  }
  const maxAge = integer(env.HR_INVENTORY_MAX_AGE_HOURS, 1, 72) || 72;
  try {
    const result = await env.DB.prepare(`
      SELECT c.id, c.name, c.slug, c.parent_id, c.sort_order,
        COUNT(DISTINCT p.id) AS product_count
      FROM categories c
      JOIN products p ON p.category_id = c.id AND p.status = 'ACTIVE'
      JOIN product_prices pp ON pp.product_id = p.id
        AND pp.variant_id IS NULL
        AND pp.country_code = ?
        AND pp.currency_code = ?
        AND pp.status = 'ACTIVE'
        AND (pp.valid_from IS NULL OR datetime(pp.valid_from) <= CURRENT_TIMESTAMP)
        AND (pp.valid_until IS NULL OR datetime(pp.valid_until) > CURRENT_TIMESTAMP)
      JOIN countries co ON co.country_code = pp.country_code
        AND co.currency_code = pp.currency_code AND co.is_active = 1
      JOIN currencies cu ON cu.code = pp.currency_code AND cu.is_active = 1
      WHERE c.is_active = 1
        AND EXISTS (
          SELECT 1
          FROM product_variants pv
          JOIN inventory i ON i.product_id = p.id AND i.variant_id = pv.id
          JOIN warehouses w ON w.id = i.warehouse_id
          WHERE pv.product_id = p.id AND pv.status = 'ACTIVE'
            AND w.country_code = co.country_code AND w.status = 'ACTIVE'
            AND i.quantity > 0
            AND i.verified_at IS NOT NULL
            AND datetime(i.verified_at) >= datetime('now', ?)
            AND datetime(i.verified_at) <= CURRENT_TIMESTAMP
        )
      GROUP BY c.id, c.name, c.slug, c.parent_id, c.sort_order
      ORDER BY c.sort_order, c.name COLLATE NOCASE
      LIMIT 100
    `).bind(country, currency, `-${maxAge} hours`).all();
    return json({
      success: true, country, currency,
      inventory_max_age_hours: maxAge,
      count: (result.results || []).length,
      categories: result.results || []
    });
  } catch (error) {
    console.error("Public category listing failed:", error);
    return json({ success: false, error: "Unable to load categories" }, 500);
  }
}

async function cancelPendingOrder(request, env) {
  if (!env.DB) return json({ success: false, error: "Database connection unavailable" }, 503);
  if (!env.HR_ADMIN_API_TOKEN) return json({ success: false, error: "Owner order access is not configured" }, 503);

  const authorization = request.headers.get("Authorization") || "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!constantTimeEqual(suppliedToken, env.HR_ADMIN_API_TOKEN)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
  if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  let data;
  try {
    const raw = await request.text();
    if (raw.length > 2000) return json({ success: false, error: "Request too large" }, 413);
    data = JSON.parse(raw);
  } catch {
    return json({ success: false, error: "Invalid JSON request" }, 400);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return json({ success: false, error: "Invalid cancellation request" }, 400);
  }
  const orderId = text(data.order_id, 100);
  if (!orderId) return json({ success: false, error: "order_id is required" }, 400);

  try {
    const existing = await env.DB.prepare(
      "SELECT id, status FROM orders WHERE id = ?"
    ).bind(orderId).first();
    if (!existing) return json({ success: false, error: "Order not found" }, 404);
    if (existing.status === "CANCELLED") {
      return json({ success: true, already_cancelled: true, order: { id: existing.id, status: existing.status } });
    }
    // Only pending orders can be cancelled through this initial safe workflow.
    // Confirmed/processing orders need a separate fulfilment-aware exception path.
    if (existing.status !== "PENDING") {
      return json({ success: false, error: "Only PENDING orders can be cancelled through this workflow", status: existing.status }, 409);
    }

    const result = await env.DB.prepare(
      "UPDATE orders SET status = 'CANCELLED' WHERE id = ? AND status = 'PENDING'"
    ).bind(orderId).run();
    if (!result.meta || result.meta.changes !== 1) {
      const latest = await env.DB.prepare(
        "SELECT id, status FROM orders WHERE id = ?"
      ).bind(orderId).first();
      if (latest && latest.status === "CANCELLED") {
        return json({ success: true, already_cancelled: true, order: { id: latest.id, status: latest.status } });
      }
      return json({ success: false, error: "Order status changed; refresh before retrying", status: latest?.status || null }, 409);
    }

    // Migration 0006 releases reserved stock in its AFTER UPDATE trigger.
    return json({
      success: true,
      message: "Pending order cancelled; reserved local stock was released by the database trigger.",
      order: { id: orderId, status: "CANCELLED" },
      inventory_release: "DATABASE_TRIGGER"
    });
  } catch (error) {
    console.error("Pending order cancellation failed:", error);
    return json({ success: false, error: "Unable to cancel this order" }, 500);
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

  let requestFingerprint;

  try {
    requestFingerprint = await orderRequestFingerprint(data);
  } catch (error) {
    console.error("Order request fingerprint failed:", error);
    return json({
      success: false,
      error: "Unable to verify this order request"
    }, 503);
  }

  try {
    const existing = await env.DB.prepare(`
      SELECT id, status, created_at, idempotency_request_hash
      FROM orders
      WHERE idempotency_key = ?
    `).bind(idempotencyKey).first();

    if (existing) {
      if (
        !existing.idempotency_request_hash ||
        !constantTimeEqual(existing.idempotency_request_hash, requestFingerprint)
      ) {
        return json({
          success: false,
          error: "This Idempotency-Key was already used for a different order request. Use a new key."
        }, 409);
      }

      return json({
        success: true,
        duplicate: true,
        message: "This order request was already received",
        order: {
          id: existing.id,
          status: existing.status,
          created_at: existing.created_at
        }
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

      const inventoryMaxAgeHours = integer(
        env.HR_INVENTORY_MAX_AGE_HOURS, 1, 72
      ) || 72;
      const inventoryMaxAgeModifier = `-${inventoryMaxAgeHours} hours`;
      const stock = await env.DB.prepare(`
        SELECT i.id
        FROM inventory i
        JOIN warehouses w ON w.id = i.warehouse_id
        WHERE i.product_id = ?
          AND i.variant_id = ?
          AND w.country_code = 'BD'
          AND w.status = 'ACTIVE'
          AND i.verified_at IS NOT NULL
          AND datetime(i.verified_at) >= datetime('now', ?)
          AND datetime(i.verified_at) <= CURRENT_TIMESTAMP
          AND i.quantity >= ?
        ORDER BY i.id
        LIMIT 1
      `).bind(
        item.productId,
        item.variantId,
        inventoryMaxAgeModifier,
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
          idempotency_key,
          idempotency_request_hash
        )
        VALUES (
          ?, ?, ?, ?, ?, ?,
          'COD', ?, ?, ?, ?,
          'PENDING', ?, 'BD', 'BDT',
          ?, ?, 0, ?,
          'LOCAL_WAREHOUSE', ?, ?
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
        idempotencyKey,
        requestFingerprint
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
          SELECT id, status, created_at, idempotency_request_hash
          FROM orders
          WHERE idempotency_key = ?
        `).bind(idempotencyKey).first();

        if (existing) {
          if (
            !existing.idempotency_request_hash ||
            !constantTimeEqual(existing.idempotency_request_hash, requestFingerprint)
          ) {
            return json({
              success: false,
              error: "This Idempotency-Key was already used for a different order request. Use a new key."
            }, 409);
          }

          return json({
            success: true,
            duplicate: true,
            message: "This order request was already received",
            order: {
              id: existing.id,
              status: existing.status,
              created_at: existing.created_at
            }
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


async function managePartnerRecommendations(request, env) {
  if (!env.DB) return json({ success: false, error: "Database connection unavailable" }, 503);
  if (!env.HR_ADMIN_API_TOKEN) return json({ success: false, error: "Owner partner access is not configured" }, 503);
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!constantTimeEqual(token, env.HR_ADMIN_API_TOKEN)) return json({ success: false, error: "Unauthorized" }, 401);
  if (request.method === "GET") {
    const url = new URL(request.url);
    const status = text(url.searchParams.get("status"), 30).toUpperCase();
    const allowed = ["PENDING_REVIEW","APPROVED","REJECTED","EXPIRED","EXECUTED"];
    if (status && !allowed.includes(status)) return json({ success: false, error: "Invalid recommendation status" }, 400);
    try {
      const query = `SELECT id, recommendation_type, order_id, partner_type, partner_id,
        recommendation_json, confidence_score, evidence_summary, status, reviewed_by,
        reviewed_at, created_at FROM partner_ai_recommendations` +
        (status ? " WHERE status = ?" : "") + " ORDER BY created_at DESC LIMIT 200";
      const result = await env.DB.prepare(query).bind(...(status ? [status] : [])).all();
      return json({ success: true, recommendations: result.results || [] });
    } catch (error) {
      console.error("Partner recommendation listing failed:", error);
      return json({ success: false, error: "Unable to load partner recommendations" }, 500);
    }
  }
  let data;
  try {
    const raw = await request.text();
    if (raw.length > 15000) return json({ success: false, error: "Request body is too large" }, 413);
    data = JSON.parse(raw);
  } catch { return json({ success: false, error: "Invalid JSON body" }, 400); }
  if (!data || typeof data !== "object" || Array.isArray(data)) return json({ success: false, error: "A JSON object is required" }, 400);
  if (request.method === "POST") {
    const type = text(data.recommendation_type, 30).toUpperCase();
    const allowed = ["COURIER_SELECTION","SUPPLIER_SELECTION","FOLLOW_UP","SLA_ALERT","COD_VARIANCE","OTHER"];
    const evidence = text(data.evidence_summary, 4000);
    let recommendation;
    try {
      recommendation = typeof data.recommendation_json === "string" ? JSON.parse(data.recommendation_json) : data.recommendation_json;
    } catch { return json({ success: false, error: "recommendation_json must contain valid JSON" }, 400); }
    if (!allowed.includes(type) || !evidence || !recommendation || typeof recommendation !== "object" || Array.isArray(recommendation)) {
      return json({ success: false, error: "A valid recommendation type, JSON object and evidence summary are required" }, 400);
    }
    const confidence = data.confidence_score == null || data.confidence_score === "" ? null : Number(data.confidence_score);
    if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
      return json({ success: false, error: "confidence_score must be between 0 and 1" }, 400);
    }
    const partnerType = text(data.partner_type, 20).toUpperCase() || null;
    if (partnerType && !["COURIER","SUPPLIER"].includes(partnerType)) return json({ success: false, error: "partner_type must be COURIER or SUPPLIER" }, 400);
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare(`INSERT INTO partner_ai_recommendations (
        id, recommendation_type, order_id, partner_type, partner_id,
        recommendation_json, confidence_score, evidence_summary, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_REVIEW')`)
        .bind(id, type, text(data.order_id, 100) || null, partnerType,
          text(data.partner_id, 100) || null, JSON.stringify(recommendation), confidence, evidence).run();
      return json({ success: true, message: "Recommendation saved to the pending review queue. No operational action was executed.", recommendation: { id, status: "PENDING_REVIEW" } }, 201);
    } catch (error) {
      console.error("Partner recommendation save failed:", error);
      return json({ success: false, error: "Unable to save partner recommendation" }, 500);
    }
  }
  if (request.method === "PATCH") {
    const id = text(data.id, 100);
    const status = text(data.status, 20).toUpperCase();
    if (!id || !["APPROVED","REJECTED"].includes(status)) return json({ success: false, error: "Recommendation id and APPROVED or REJECTED status are required" }, 400);
    try {
      const result = await env.DB.prepare(`UPDATE partner_ai_recommendations
        SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'PENDING_REVIEW'`)
        .bind(status, text(env.HR_ADMIN_OWNER_LABEL, 100) || "OWNER", id).run();
      if (!result.meta || result.meta.changes !== 1) return json({ success: false, error: "Pending recommendation not found or already reviewed" }, 409);
      return json({ success: true, message: "Recommendation review recorded. Approval does not execute a booking, purchase, message or payment.", recommendation: { id, status } });
    } catch (error) {
      console.error("Partner recommendation review failed:", error);
      return json({ success: false, error: "Unable to review recommendation" }, 500);
    }
  }
  return json({ success: false, error: "Method not allowed" }, 405);
}

async function manageCourierServiceAreas(request, env) {
  if (!env.DB) return json({ success: false, error: "Database connection unavailable" }, 503);
  if (!env.HR_ADMIN_API_TOKEN) return json({ success: false, error: "Owner partner access is not configured" }, 503);
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!constantTimeEqual(token, env.HR_ADMIN_API_TOKEN)) return json({ success: false, error: "Unauthorized" }, 401);
  if (request.method === "GET") {
    const url = new URL(request.url);
    const courierId = text(url.searchParams.get("courier_id"), 100);
    try {
      let query = `SELECT a.id, a.courier_id, c.partner_name, a.country_code, a.district,
        a.area_name, a.postcode, a.service_type, a.active, a.evidence_reference,
        a.verified_at, a.valid_until
        FROM courier_service_areas a JOIN courier_partners c ON c.id = a.courier_id`;
      const values = [];
      if (courierId) { query += " WHERE a.courier_id = ?"; values.push(courierId); }
      query += " ORDER BY a.district COLLATE NOCASE, a.area_name COLLATE NOCASE LIMIT 500";
      const result = await env.DB.prepare(query).bind(...values).all();
      return json({ success: true, service_areas: result.results || [] });
    } catch (error) {
      console.error("Courier service-area listing failed:", error);
      return json({ success: false, error: "Unable to load courier service areas" }, 500);
    }
  }
  if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  let data;
  try {
    const raw = await request.text();
    if (raw.length > 10000) return json({ success: false, error: "Request body is too large" }, 413);
    data = JSON.parse(raw);
  } catch { return json({ success: false, error: "Invalid JSON body" }, 400); }
  if (!data || typeof data !== "object" || Array.isArray(data)) return json({ success: false, error: "A JSON object is required" }, 400);
  const courierId = text(data.courier_id, 100);
  const district = text(data.district, 120);
  const areaName = text(data.area_name, 120) || null;
  const postcode = text(data.postcode, 20) || null;
  const countryCode = text(data.country_code, 2).toUpperCase() || "BD";
  const serviceType = text(data.service_type, 20).toUpperCase() || "STANDARD";
  if (!courierId || !district || !/^[A-Z]{2}$/.test(countryCode) ||
      !["STANDARD","EXPRESS","SAME_DAY","PICKUP_ONLY","RETURN_ONLY"].includes(serviceType)) {
    return json({ success: false, error: "Courier, district, two-letter country code and valid service type are required" }, 400);
  }
  try {
    const courier = await env.DB.prepare("SELECT id FROM courier_partners WHERE id = ?").bind(courierId).first();
    if (!courier) return json({ success: false, error: "Courier partner was not found" }, 404);
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO courier_service_areas
      (id, courier_id, country_code, district, area_name, postcode, service_type, active, evidence_reference, verified_at, valid_until)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?)`)
      .bind(id, courierId, countryCode, district, areaName, postcode, serviceType,
        text(data.evidence_reference, 500) || null, text(data.valid_until, 40) || null).run();
    return json({
      success: true,
      message: "Service area saved as inactive and unverified. It cannot be used for courier selection.",
      service_area: { id, courier_id: courierId, active: false, verified_at: null }
    }, 201);
  } catch (error) {
    console.error("Courier service-area save failed:", error);
    return json({ success: false, error: "Unable to save courier service area" }, 500);
  }
}

async function manageLocalSupplierProfiles(request, env) {
  if (!env.DB) return json({ success: false, error: "Database connection unavailable" }, 503);
  if (!env.HR_ADMIN_API_TOKEN) return json({ success: false, error: "Owner partner access is not configured" }, 503);
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!constantTimeEqual(token, env.HR_ADMIN_API_TOKEN)) return json({ success: false, error: "Unauthorized" }, 401);
  if (request.method !== "PUT") return json({ success: false, error: "Method not allowed" }, 405);
  let data;
  try {
    const raw = await request.text();
    if (raw.length > 12000) return json({ success: false, error: "Request body is too large" }, 413);
    data = JSON.parse(raw);
  } catch { return json({ success: false, error: "Invalid JSON body" }, 400); }
  if (!data || typeof data !== "object" || Array.isArray(data)) return json({ success: false, error: "A JSON object is required" }, 400);
  const supplierId = text(data.supplier_id, 100);
  const businessType = text(data.business_type, 30).toUpperCase() || "OTHER";
  const sampleStatus = text(data.sample_status, 20).toUpperCase() || "NOT_REQUESTED";
  const quality = data.quality_score == null || data.quality_score === "" ? null : Number(data.quality_score);
  const dispatch = data.dispatch_score == null || data.dispatch_score === "" ? null : Number(data.dispatch_score);
  const response = data.response_score == null || data.response_score === "" ? null : Number(data.response_score);
  const scoreValues = [quality, dispatch, response].filter(v => v !== null);
  if (!supplierId || !["MANUFACTURER","WHOLESALER","DISTRIBUTOR","IMPORTER","AUTHORIZED_RESELLER","OTHER"].includes(businessType) ||
      !["NOT_REQUESTED","REQUESTED","RECEIVED","PASSED","FAILED"].includes(sampleStatus) ||
      scoreValues.some(v => !Number.isFinite(v) || v < 0 || v > 100)) {
    return json({ success: false, error: "Supplier, valid business type, sample status and optional 0–100 scores are required" }, 400);
  }
  try {
    const supplier = await env.DB.prepare("SELECT id FROM suppliers WHERE id = ?").bind(supplierId).first();
    if (!supplier) return json({ success: false, error: "Supplier was not found" }, 404);
    await env.DB.prepare(`INSERT INTO supplier_local_profiles (
      supplier_id, business_type, verification_status, district, area_name, pickup_address,
      direct_to_customer, blind_shipping_supported, branded_packaging_supported, sample_status,
      quality_score, dispatch_score, response_score, last_stock_verified_at, verification_evidence, updated_at
    ) VALUES (?, ?, 'UNVERIFIED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(supplier_id) DO UPDATE SET
      business_type = excluded.business_type, district = excluded.district,
      area_name = excluded.area_name, pickup_address = excluded.pickup_address,
      direct_to_customer = excluded.direct_to_customer,
      blind_shipping_supported = excluded.blind_shipping_supported,
      branded_packaging_supported = excluded.branded_packaging_supported,
      sample_status = excluded.sample_status, quality_score = excluded.quality_score,
      dispatch_score = excluded.dispatch_score, response_score = excluded.response_score,
      verification_evidence = excluded.verification_evidence, updated_at = CURRENT_TIMESTAMP`)
      .bind(supplierId, businessType, text(data.district, 120) || null,
        text(data.area_name, 120) || null, text(data.pickup_address, 500) || null,
        data.direct_to_customer === true ? 1 : 0, data.blind_shipping_supported === true ? 1 : 0,
        data.branded_packaging_supported === true ? 1 : 0, sampleStatus,
        quality, dispatch, response, text(data.verification_evidence, 500) || null).run();
    return json({ success: true, message: "Local supplier profile saved. Verification remains UNVERIFIED and stock freshness is not asserted.", supplier_profile: { supplier_id: supplierId, verification_status: "UNVERIFIED", last_stock_verified_at: null } }, 200);
  } catch (error) {
    console.error("Local supplier profile save failed:", error);
    return json({ success: false, error: "Unable to save local supplier profile" }, 500);
  }
}

async function manageLocalSupplierQuotes(request, env) {
  if (!env.DB) return json({ success: false, error: "Database connection unavailable" }, 503);
  if (!env.HR_ADMIN_API_TOKEN) return json({ success: false, error: "Owner partner access is not configured" }, 503);
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!constantTimeEqual(token, env.HR_ADMIN_API_TOKEN)) return json({ success: false, error: "Unauthorized" }, 401);
  if (request.method === "GET") {
    const url = new URL(request.url);
    const supplierId = text(url.searchParams.get("supplier_id"), 100);
    const productId = text(url.searchParams.get("product_id"), 100);
    try {
      const conditions = [], values = [];
      if (supplierId) { conditions.push("q.supplier_id = ?"); values.push(supplierId); }
      if (productId) { conditions.push("q.product_id = ?"); values.push(productId); }
      let query = `SELECT q.id, q.supplier_id, s.supplier_name, q.product_id, p.name AS product_name,
        q.variant_id, q.supplier_sku, q.unit_cost_minor, q.currency_code, q.available_quantity,
        q.minimum_order_quantity, q.lead_time_hours, q.quote_status, q.stock_verified_at,
        q.valid_until, q.evidence_reference, q.created_at
        FROM supplier_local_quotes q JOIN suppliers s ON s.id = q.supplier_id
        JOIN products p ON p.id = q.product_id`;
      if (conditions.length) query += " WHERE " + conditions.join(" AND ");
      query += " ORDER BY q.created_at DESC LIMIT 300";
      const result = await env.DB.prepare(query).bind(...values).all();
      return json({ success: true, quotes: result.results || [] });
    } catch (error) {
      console.error("Local supplier quote listing failed:", error);
      return json({ success: false, error: "Unable to load supplier quotes" }, 500);
    }
  }
  if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  let data;
  try {
    const raw = await request.text();
    if (raw.length > 10000) return json({ success: false, error: "Request body is too large" }, 413);
    data = JSON.parse(raw);
  } catch { return json({ success: false, error: "Invalid JSON body" }, 400); }
  if (!data || typeof data !== "object" || Array.isArray(data)) return json({ success: false, error: "A JSON object is required" }, 400);
  const supplierId = text(data.supplier_id, 100), productId = text(data.product_id, 100);
  const variantId = text(data.variant_id, 100) || null;
  const currencyCode = text(data.currency_code, 3).toUpperCase() || "BDT";
  const cost = Number(data.unit_cost_minor), quantity = data.available_quantity == null || data.available_quantity === "" ? null : Number(data.available_quantity);
  const moq = Number(data.minimum_order_quantity ?? 1), lead = data.lead_time_hours == null || data.lead_time_hours === "" ? null : Number(data.lead_time_hours);
  if (!supplierId || !productId || !Number.isSafeInteger(cost) || cost < 0 ||
      !Number.isSafeInteger(moq) || moq < 1 ||
      (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 0)) ||
      (lead !== null && (!Number.isSafeInteger(lead) || lead < 0))) {
    return json({ success: false, error: "Supplier, product, non-negative integer unit cost, valid stock, MOQ and lead time are required" }, 400);
  }
  try {
    const [supplier, product, currency] = await Promise.all([
      env.DB.prepare("SELECT id FROM suppliers WHERE id = ?").bind(supplierId).first(),
      env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(productId).first(),
      env.DB.prepare("SELECT code FROM currencies WHERE code = ?").bind(currencyCode).first()
    ]);
    if (!supplier || !product || !currency) return json({ success: false, error: "Supplier, product or currency was not found" }, 404);
    if (variantId) {
      const variant = await env.DB.prepare("SELECT id FROM product_variants WHERE id = ? AND product_id = ?").bind(variantId, productId).first();
      if (!variant) return json({ success: false, error: "Variant does not belong to the selected product" }, 400);
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO supplier_local_quotes (
      id, supplier_id, product_id, variant_id, supplier_sku, unit_cost_minor, currency_code,
      available_quantity, minimum_order_quantity, lead_time_hours, quote_status,
      stock_verified_at, valid_until, evidence_reference
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?)`)
      .bind(id, supplierId, productId, variantId, text(data.supplier_sku, 120) || null,
        cost, currencyCode, quantity, moq, lead, text(data.valid_until, 40) || null,
        text(data.evidence_reference, 500) || null).run();
    return json({ success: true, message: "Supplier quote saved as PENDING; stock and price are not treated as verified.", quote: { id, supplier_id: supplierId, product_id: productId, quote_status: "PENDING", stock_verified_at: null } }, 201);
  } catch (error) {
    console.error("Local supplier quote save failed:", error);
    return json({ success: false, error: "Unable to save supplier quote" }, 500);
  }
}

async function manageCourierRates(request, env) {
  if (!env.DB) return json({ success: false, error: "Database connection unavailable" }, 503);
  if (!env.HR_ADMIN_API_TOKEN) return json({ success: false, error: "Owner partner access is not configured" }, 503);
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!constantTimeEqual(token, env.HR_ADMIN_API_TOKEN)) return json({ success: false, error: "Unauthorized" }, 401);
  if (request.method === "GET") {
    const url = new URL(request.url);
    const courierId = text(url.searchParams.get("courier_id"), 100);
    try {
      let query = `SELECT r.id, r.courier_id, c.partner_name, r.rate_name, r.origin_zone,
        r.destination_district, r.destination_area, r.service_type, r.weight_from_grams,
        r.weight_to_grams, r.base_fee_minor, r.cod_fee_minor, r.return_fee_minor,
        r.remote_area_fee_minor, r.currency_code, r.estimated_min_days, r.estimated_max_days,
        r.pickup_cutoff_local, r.effective_from, r.effective_until, r.verification_status,
        r.evidence_reference, r.verified_at, r.created_at
        FROM courier_rate_cards r JOIN courier_partners c ON c.id = r.courier_id`;
      const values = [];
      if (courierId) { query += " WHERE r.courier_id = ?"; values.push(courierId); }
      query += " ORDER BY r.created_at DESC LIMIT 200";
      const result = await env.DB.prepare(query).bind(...values).all();
      return json({ success: true, rate_cards: result.results || [] });
    } catch (error) {
      console.error("Courier rate listing failed:", error);
      return json({ success: false, error: "Unable to load courier rates" }, 500);
    }
  }
  if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  let data;
  try {
    const raw = await request.text();
    if (raw.length > 10000) return json({ success: false, error: "Request body is too large" }, 413);
    data = JSON.parse(raw);
  } catch { return json({ success: false, error: "Invalid JSON body" }, 400); }
  if (!data || typeof data !== "object" || Array.isArray(data)) return json({ success: false, error: "A JSON object is required" }, 400);
  const courierId = text(data.courier_id, 100);
  const rateName = text(data.rate_name, 160);
  const serviceType = text(data.service_type, 20).toUpperCase() || "STANDARD";
  const currencyCode = text(data.currency_code, 3).toUpperCase() || "BDT";
  const weightFrom = Number(data.weight_from_grams ?? 0);
  const weightTo = data.weight_to_grams === "" || data.weight_to_grams == null ? null : Number(data.weight_to_grams);
  const baseFee = Number(data.base_fee_minor);
  const codFee = Number(data.cod_fee_minor ?? 0);
  const returnFee = Number(data.return_fee_minor ?? 0);
  const remoteFee = Number(data.remote_area_fee_minor ?? 0);
  const minDays = data.estimated_min_days === "" || data.estimated_min_days == null ? null : Number(data.estimated_min_days);
  const maxDays = data.estimated_max_days === "" || data.estimated_max_days == null ? null : Number(data.estimated_max_days);
  const allowed = ["STANDARD","EXPRESS","SAME_DAY","PICKUP_ONLY","RETURN_ONLY"];
  const integers = [weightFrom, baseFee, codFee, returnFee, remoteFee, ...(weightTo === null ? [] : [weightTo]), ...(minDays === null ? [] : [minDays]), ...(maxDays === null ? [] : [maxDays])];
  if (!courierId || !rateName || !allowed.includes(serviceType) || integers.some(n => !Number.isSafeInteger(n) || n < 0) ||
      (weightTo !== null && weightTo < weightFrom) || (minDays !== null && maxDays !== null && minDays > maxDays)) {
    return json({ success: false, error: "Courier, rate name, valid service type, non-negative integer fees/weights and valid delivery range are required" }, 400);
  }
  const courier = await env.DB.prepare("SELECT id FROM courier_partners WHERE id = ?").bind(courierId).first();
  if (!courier) return json({ success: false, error: "Courier partner was not found" }, 404);
  const currency = await env.DB.prepare("SELECT code FROM currencies WHERE code = ?").bind(currencyCode).first();
  if (!currency) return json({ success: false, error: "Currency code is not configured" }, 400);
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(`INSERT INTO courier_rate_cards (
      id, courier_id, rate_name, origin_zone, destination_district, destination_area,
      service_type, weight_from_grams, weight_to_grams, base_fee_minor, cod_fee_minor,
      return_fee_minor, remote_area_fee_minor, currency_code, estimated_min_days,
      estimated_max_days, pickup_cutoff_local, effective_from, effective_until,
      verification_status, evidence_reference, verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNVERIFIED', ?, NULL)`)
      .bind(id, courierId, rateName, text(data.origin_zone, 120) || null,
        text(data.destination_district, 120) || null, text(data.destination_area, 120) || null,
        serviceType, weightFrom, weightTo, baseFee, codFee, returnFee, remoteFee, currencyCode,
        minDays, maxDays, text(data.pickup_cutoff_local, 20) || null,
        text(data.effective_from, 40) || null, text(data.effective_until, 40) || null,
        text(data.evidence_reference, 500) || null).run();
    return json({ success: true, message: "Rate card saved as UNVERIFIED. It cannot be used for automatic courier selection until separately reviewed.", rate_card: { id, courier_id: courierId, verification_status: "UNVERIFIED" } }, 201);
  } catch (error) {
    console.error("Courier rate save failed:", error);
    return json({ success: false, error: "Unable to save courier rate card" }, 500);
  }
}

async function listLocalSuppliers(request, env) {
  if (!env.DB) return json({ success: false, error: "Database connection unavailable" }, 503);
  if (!env.HR_ADMIN_API_TOKEN) return json({ success: false, error: "Owner partner access is not configured" }, 503);
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!constantTimeEqual(token, env.HR_ADMIN_API_TOKEN)) return json({ success: false, error: "Unauthorized" }, 401);
  if (request.method !== "GET") return json({ success: false, error: "Method not allowed" }, 405);
  const url = new URL(request.url);
  const search = text(url.searchParams.get("q"), 100);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  try {
    let query = `
      SELECT s.id, s.supplier_name, s.origin_country_code, s.contact_email, s.status, s.created_at,
        p.business_type, p.verification_status, p.district, p.area_name,
        p.direct_to_customer, p.blind_shipping_supported, p.branded_packaging_supported,
        p.sample_status, p.quality_score, p.dispatch_score, p.response_score,
        p.last_stock_verified_at
      FROM suppliers s
      LEFT JOIN supplier_local_profiles p ON p.supplier_id = s.id
    `;
    const values = [];
    if (search) {
      query += " WHERE s.supplier_name LIKE ? OR s.contact_email LIKE ? OR s.id = ?";
      values.push("%" + search + "%", "%" + search + "%", search);
    }
    query += " ORDER BY s.supplier_name COLLATE NOCASE LIMIT ?";
    values.push(limit);
    const result = await env.DB.prepare(query).bind(...values).all();
    return json({ success: true, suppliers: result.results || [] });
  } catch (error) {
    console.error("Local supplier listing failed:", error);
    return json({ success: false, error: "Unable to load supplier directory" }, 500);
  }
}

async function managePartnerContacts(request, env) {
  if (!env.DB) return json({ success: false, error: "Database connection unavailable" }, 503);
  if (!env.HR_ADMIN_API_TOKEN) return json({ success: false, error: "Owner partner access is not configured" }, 503);
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!constantTimeEqual(token, env.HR_ADMIN_API_TOKEN)) return json({ success: false, error: "Unauthorized" }, 401);

  if (request.method === "GET") {
    const url = new URL(request.url);
    const partnerType = text(url.searchParams.get("partner_type"), 20).toUpperCase();
    const partnerId = text(url.searchParams.get("partner_id"), 100);
    if (partnerType && !["COURIER", "SUPPLIER"].includes(partnerType)) {
      return json({ success: false, error: "partner_type must be COURIER or SUPPLIER" }, 400);
    }
    try {
      let query = "SELECT id, partner_type, partner_id, contact_name, role_title, email, phone, preferred_channel, is_primary, verification_status, verified_at, notes, created_at FROM partner_contacts";
      const conditions = [];
      const values = [];
      if (partnerType) { conditions.push("partner_type = ?"); values.push(partnerType); }
      if (partnerId) { conditions.push("partner_id = ?"); values.push(partnerId); }
      if (conditions.length) query += " WHERE " + conditions.join(" AND ");
      query += " ORDER BY is_primary DESC, contact_name COLLATE NOCASE LIMIT 200";
      const result = await env.DB.prepare(query).bind(...values).all();
      return json({ success: true, contacts: result.results || [] });
    } catch (error) {
      console.error("Partner contacts listing failed:", error);
      return json({ success: false, error: "Unable to load partner contacts" }, 500);
    }
  }

  if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  let data;
  try {
    const raw = await request.text();
    if (raw.length > 10000) return json({ success: false, error: "Request body is too large" }, 413);
    data = JSON.parse(raw);
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return json({ success: false, error: "A JSON object is required" }, 400);
  }
  const partnerType = text(data.partner_type, 20).toUpperCase();
  const partnerId = text(data.partner_id, 100);
  const contactName = text(data.contact_name, 160);
  const email = text(data.email, 254).toLowerCase() || null;
  const phone = text(data.phone, 40) || null;
  const channel = text(data.preferred_channel, 20).toUpperCase() || null;
  if (!["COURIER", "SUPPLIER"].includes(partnerType) || !partnerId || (!contactName && !email && !phone)) {
    return json({ success: false, error: "partner_type, partner_id and at least one contact detail are required" }, 400);
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ success: false, error: "A valid email address is required" }, 400);
  }
  if (channel && !["EMAIL", "PHONE", "WHATSAPP", "OTHER"].includes(channel)) {
    return json({ success: false, error: "preferred_channel must be EMAIL, PHONE, WHATSAPP or OTHER" }, 400);
  }
  try {
    const table = partnerType === "COURIER" ? "courier_partners" : "suppliers";
    const partner = await env.DB.prepare("SELECT id FROM " + table + " WHERE id = ?").bind(partnerId).first();
    if (!partner) return json({ success: false, error: "Partner was not found" }, 404);
    const id = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO partner_contacts (
        id, partner_type, partner_id, contact_name, role_title, email,
        phone, preferred_channel, is_primary, verification_status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'UNVERIFIED', ?)
    `).bind(id, partnerType, partnerId, contactName || null,
      text(data.role_title, 120) || null, email, phone, channel,
      text(data.notes, 2000) || null).run();
    return json({
      success: true,
      message: "Contact saved as unverified. Verify the person's identity and channel before relying on it.",
      contact: { id, partner_type: partnerType, partner_id: partnerId, verification_status: "UNVERIFIED", is_primary: false }
    }, 201);
  } catch (error) {
    console.error("Partner contact save failed:", error);
    return json({ success: false, error: "Unable to save partner contact" }, 500);
  }
}

async function managePartnerInteractions(request, env) {
  if (!env.DB) return json({ success: false, error: "Database connection unavailable" }, 503);
  if (!env.HR_ADMIN_API_TOKEN) return json({ success: false, error: "Owner partner access is not configured" }, 503);
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!constantTimeEqual(token, env.HR_ADMIN_API_TOKEN)) return json({ success: false, error: "Unauthorized" }, 401);

  if (request.method === "GET") {
    const url = new URL(request.url);
    const partnerType = text(url.searchParams.get("partner_type"), 20).toUpperCase();
    const partnerId = text(url.searchParams.get("partner_id"), 100);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    if (partnerType && !["COURIER", "SUPPLIER"].includes(partnerType)) {
      return json({ success: false, error: "partner_type must be COURIER or SUPPLIER" }, 400);
    }
    try {
      let query = "SELECT id, partner_type, partner_id, interaction_type, direction, subject, summary, outcome, follow_up_at, approval_status, evidence_reference, created_by, created_at FROM partner_interactions";
      const conditions = [];
      const values = [];
      if (partnerType) { conditions.push("partner_type = ?"); values.push(partnerType); }
      if (partnerId) { conditions.push("partner_id = ?"); values.push(partnerId); }
      if (conditions.length) query += " WHERE " + conditions.join(" AND ");
      query += " ORDER BY COALESCE(follow_up_at, created_at) ASC, created_at DESC LIMIT ?";
      values.push(limit);
      const result = await env.DB.prepare(query).bind(...values).all();
      return json({ success: true, interactions: result.results || [] });
    } catch (error) {
      console.error("Partner interaction listing failed:", error);
      return json({ success: false, error: "Unable to load partner interactions" }, 500);
    }
  }

  if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  let data;
  try {
    const raw = await request.text();
    if (raw.length > 12000) return json({ success: false, error: "Request body is too large" }, 413);
    data = JSON.parse(raw);
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return json({ success: false, error: "A JSON object is required" }, 400);
  }

  const partnerType = text(data.partner_type, 20).toUpperCase();
  const partnerId = text(data.partner_id, 100);
  const interactionType = text(data.interaction_type, 30).toUpperCase();
  const summary = text(data.summary, 4000);
  const allowedTypes = ["RESEARCH", "EMAIL", "PHONE", "WHATSAPP", "MEETING", "QUOTE_RECEIVED", "CONTRACT", "SUPPORT_CASE", "FOLLOW_UP", "OTHER"];
  if (!["COURIER", "SUPPLIER"].includes(partnerType) || !partnerId || !allowedTypes.includes(interactionType) || !summary) {
    return json({ success: false, error: "partner_type, partner_id, valid interaction_type and summary are required" }, 400);
  }
  const followUpAt = text(data.follow_up_at, 40) || null;
  if (followUpAt && !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(followUpAt)) {
    return json({ success: false, error: "follow_up_at must be an ISO date or datetime" }, 400);
  }

  try {
    const table = partnerType === "COURIER" ? "courier_partners" : "suppliers";
    const partner = await env.DB.prepare("SELECT id FROM " + table + " WHERE id = ?").bind(partnerId).first();
    if (!partner) return json({ success: false, error: "Partner was not found" }, 404);
    const id = crypto.randomUUID();
    const subject = text(data.subject, 200) || null;
    const outcome = text(data.outcome, 1000) || null;
    const evidence = text(data.evidence_reference, 500) || null;
    const result = await env.DB.prepare(`
      INSERT INTO partner_interactions (
        id, partner_type, partner_id, interaction_type, direction,
        subject, summary, outcome, follow_up_at, approval_status,
        evidence_reference, created_by
      ) VALUES (?, ?, ?, ?, 'INTERNAL', ?, ?, ?, ?, 'INTERNAL_NOTE', ?, 'OWNER')
    `).bind(id, partnerType, partnerId, interactionType, subject, summary, outcome, followUpAt, evidence).run();
    return json({
      success: true,
      message: "Internal partner note saved. No message was sent and no partner was contacted.",
      interaction: { id, partner_type: partnerType, partner_id: partnerId, interaction_type: interactionType, direction: "INTERNAL", approval_status: "INTERNAL_NOTE" }
    }, 201);
  } catch (error) {
    console.error("Partner interaction save failed:", error);
    return json({ success: false, error: "Unable to save partner interaction" }, 500);
  }
}

async function manageCourierPartners(request, env) {
  if (!env.DB) return json({ success: false, error: "Database connection unavailable" }, 503);
  if (!env.HR_ADMIN_API_TOKEN) return json({ success: false, error: "Owner partner access is not configured" }, 503);
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!constantTimeEqual(token, env.HR_ADMIN_API_TOKEN)) return json({ success: false, error: "Unauthorized" }, 401);

  if (request.method === "GET") {
    try {
      const rows = await env.DB.prepare(`
        SELECT id, partner_code, partner_name, website_url, onboarding_status,
          api_status, cod_supported, pickup_supported, tracking_supported,
          webhook_supported, fulfillment_supported, relationship_owner,
          last_contacted_at, next_follow_up_at, contract_status,
          contract_expires_at, created_at, updated_at
        FROM courier_partners
        ORDER BY CASE onboarding_status WHEN 'ACTIVE' THEN 0 WHEN 'ONBOARDING' THEN 1 ELSE 2 END,
          partner_name COLLATE NOCASE
        LIMIT 200
      `).all();
      return json({ success: true, partners: rows.results || [] });
    } catch (error) {
      console.error("Courier partner listing failed:", error);
      return json({ success: false, error: "Unable to load courier partners" }, 500);
    }
  }

  if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  let data;
  try {
    const raw = await request.text();
    if (raw.length > 12000) return json({ success: false, error: "Request body is too large" }, 413);
    data = JSON.parse(raw);
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return json({ success: false, error: "A JSON object is required" }, 400);
  }

  const partnerName = text(data.partner_name, 160);
  const partnerCode = text(data.partner_code, 60).toUpperCase();
  const websiteUrl = text(data.website_url, 500);
  if (!partnerName || !/^[A-Z0-9][A-Z0-9_-]{1,59}$/.test(partnerCode)) {
    return json({ success: false, error: "A partner_name and valid partner_code are required" }, 400);
  }
  if (websiteUrl && !/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?(?:\/[^\s]*)?$/i.test(websiteUrl)) {
    return json({ success: false, error: "website_url must be a valid HTTPS URL" }, 400);
  }

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(`
      INSERT INTO courier_partners (
        id, partner_code, partner_name, website_url,
        onboarding_status, api_status, cod_supported, pickup_supported,
        tracking_supported, webhook_supported, fulfillment_supported,
        contract_status, internal_notes
      ) VALUES (?, ?, ?, ?, 'RESEARCH', 'NOT_ASSESSED', 0, 0, 0, 0, 0, 'NONE', ?)
    `).bind(id, partnerCode, partnerName, websiteUrl || null,
      text(data.internal_notes, 2000) || null).run();
    return json({
      success: true,
      message: "Courier partner added to the research directory; no account has been connected.",
      partner: { id, partner_code: partnerCode, partner_name: partnerName, onboarding_status: "RESEARCH", api_status: "NOT_ASSESSED" }
    }, 201);
  } catch (error) {
    const message = String(error && error.message || "").toLowerCase();
    if (message.includes("unique")) return json({ success: false, error: "That partner_code already exists" }, 409);
    console.error("Courier partner creation failed:", error);
    return json({ success: false, error: "Unable to add courier partner" }, 500);
  }
}



async function manageCatalogAdmin(request, env) {
  if (!env.DB) return json({success:false,error:"Database connection unavailable"},503);
  if (!env.HR_ADMIN_API_TOKEN) return json({success:false,error:"Owner catalog access is not configured"},503);
  const auth=request.headers.get("Authorization")||"";
  const token=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!constantTimeEqual(token,env.HR_ADMIN_API_TOKEN)) return json({success:false,error:"Unauthorized"},401);
  if(request.method==="GET"){
    const url=new URL(request.url),view=text(url.searchParams.get("view")||"products",20);
    const limit=Math.min(100,Math.max(1,Number(url.searchParams.get("limit"))||50));
    try{
      if(view==="categories"){
        const rows=await env.DB.prepare("SELECT id,name,slug,parent_id,is_active,sort_order FROM categories ORDER BY sort_order,name LIMIT ?").bind(limit).all();
        return json({success:true,categories:rows.results||[]});
      }
      if(view==="variants"){
        const pid=text(url.searchParams.get("product_id"),100);
        if(!pid)return json({success:false,error:"product_id is required"},400);
        const rows=await env.DB.prepare("SELECT id,product_id,sku,variant_name,attributes_json,status,created_at FROM product_variants WHERE product_id=? ORDER BY created_at DESC LIMIT ?").bind(pid,limit).all();
        return json({success:true,variants:rows.results||[]});
      }
      if(view==="prices"){
        const pid=text(url.searchParams.get("product_id"),100);
        if(!pid)return json({success:false,error:"product_id is required"},400);
        const rows=await env.DB.prepare("SELECT id,product_id,variant_id,country_code,currency_code,price_minor,compare_at_price_minor,status,valid_from,valid_until FROM product_prices WHERE product_id=? ORDER BY created_at DESC LIMIT ?").bind(pid,limit).all();
        return json({success:true,prices:rows.results||[]});
      }
      if(view!=="products")return json({success:false,error:"Unsupported catalog view"},400);
      const rows=await env.DB.prepare("SELECT p.id,p.category_id,p.name,p.slug,p.description,p.brand,p.status,p.created_at,p.updated_at,c.name AS category_name,(SELECT COUNT(*) FROM product_variants v WHERE v.product_id=p.id) AS variant_count,(SELECT COUNT(*) FROM product_prices pp WHERE pp.product_id=p.id) AS price_count FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.updated_at DESC,p.created_at DESC LIMIT ?").bind(limit).all();
      return json({success:true,products:rows.results||[]});
    }catch(error){console.error("Catalog list failed:",error);return json({success:false,error:"Unable to load catalog"},500);}
  }
  if(request.method!=="POST")return json({success:false,error:"Method not allowed"},405);
  let data;
  try{const raw=await request.text();if(raw.length>12000)return json({success:false,error:"Request too large"},413);data=JSON.parse(raw);}
  catch{return json({success:false,error:"Invalid JSON request"},400);}
  if(!data||typeof data!=="object"||Array.isArray(data))return json({success:false,error:"Invalid catalog operation"},400);
  const recordCatalogAudit=async(mutation,type,id,action,before,table,fields)=>{
    const after="json_object("+fields.map(k=>"'"+k+"', "+k).join(",")+")";
    const log=env.DB.prepare("INSERT INTO catalog_admin_audit (id,entity_type,entity_id,action,actor,before_json,after_json) VALUES (?,?,(SELECT id FROM "+table+" WHERE id=? AND changes()=1),?,?,?,(SELECT "+after+" FROM "+table+" WHERE id=?))")
      .bind(crypto.randomUUID(),type,id,action,text(env.HR_ADMIN_OWNER_LABEL,80)||"OWNER",before?JSON.stringify(before):null,id);
    const result=await env.DB.batch([mutation,log]);
    if(result[0]?.meta?.changes!==1||result[1]?.meta?.changes!==1)throw new Error("Catalog update and audit were not both committed");
  };
  try{
    if(data.operation==="save_category"){
      const id=text(data.id,100)||crypto.randomUUID(),name=text(data.name,120),slug=text(data.slug,140).toLowerCase(),parent=text(data.parent_id,100)||null,sort=integer(data.sort_order??0,-100000,100000);
      if(!name||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||sort===null)return json({success:false,error:"Category name, valid slug and integer sort order are required"},400);
      if(parent===id)return json({success:false,error:"A category cannot be its own parent"},400);
      if(parent&&!await env.DB.prepare("SELECT id FROM categories WHERE id=?").bind(parent).first())return json({success:false,error:"Parent category not found"},409);
      const before=await env.DB.prepare("SELECT * FROM categories WHERE id=?").bind(id).first();
      if(parent){const cycle=await env.DB.prepare("WITH RECURSIVE descendants(id) AS (SELECT id FROM categories WHERE parent_id=? UNION SELECT c.id FROM categories c JOIN descendants d ON c.parent_id=d.id) SELECT 1 AS cycle FROM descendants WHERE id=? LIMIT 1").bind(id,parent).first();if(cycle)return json({success:false,error:"Category parent change would create a hierarchy cycle"},409);}
      if(before&&before.is_active)return json({success:false,error:"Deactivate category before editing its details"},409);
      const mutation=before
        ?env.DB.prepare("UPDATE categories SET name=?,slug=?,parent_id=?,sort_order=? WHERE id=? AND is_active=0").bind(name,slug,parent,sort,id)
        :env.DB.prepare("INSERT INTO categories (id,name,slug,parent_id,is_active,sort_order) VALUES (?,?,?, ?,0,?)").bind(id,name,slug,parent,sort);
      await recordCatalogAudit(mutation,"CATEGORY",id,before?"CATEGORY_UPDATED":"CATEGORY_CREATED",before,"categories",["id","name","slug","parent_id","is_active","sort_order"]);
      return json({success:true,category:await env.DB.prepare("SELECT * FROM categories WHERE id=?").bind(id).first()},before?200:201);
    }
    if(data.operation==="set_category_status"){
      const id=text(data.id,100),active=data.is_active;
      if(!id||![true,false,0,1].includes(active))return json({success:false,error:"Category and active state are required"},400);
      const before=await env.DB.prepare("SELECT * FROM categories WHERE id=?").bind(id).first();
      if(!before)return json({success:false,error:"Category not found"},404);
      if((active===true||active===1)&&before.parent_id){
        const parent=await env.DB.prepare("SELECT is_active FROM categories WHERE id=?").bind(before.parent_id).first();
        if(!parent||!parent.is_active)return json({success:false,error:"Activate the parent category first"},409);
      }
      if(active===false||active===0){
        const children=await env.DB.prepare("SELECT COUNT(*) AS n FROM categories WHERE parent_id=? AND is_active=1").bind(id).first();
        if(Number(children?.n||0)>0)return json({success:false,error:"Deactivate active child categories first"},409);
      }
      const value=active===true||active===1?1:0;
      const mutation=env.DB.prepare("UPDATE categories SET is_active=? WHERE id=? AND is_active=?").bind(value,id,before.is_active);
      await recordCatalogAudit(mutation,"CATEGORY",id,"CATEGORY_STATUS_CHANGED",before,"categories",["id","name","slug","parent_id","is_active","sort_order"]);
      return json({success:true,id,is_active:value});
    }
    if(data.operation==="save_product"){
      const id=text(data.id,100)||crypto.randomUUID(),name=text(data.name,180),slug=text(data.slug,180).toLowerCase(),category=text(data.category_id,100);
      if(!name||!category||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))return json({success:false,error:"Product name, category and valid slug are required"},400);
      if(!await env.DB.prepare("SELECT id FROM categories WHERE id=?").bind(category).first())return json({success:false,error:"Category not found"},409);
      const before=await env.DB.prepare("SELECT * FROM products WHERE id=?").bind(id).first();
      if(before?.status==="ACTIVE")return json({success:false,error:"Pause product before editing details"},409);
      const mutation=before
        ?env.DB.prepare("UPDATE products SET category_id=?,name=?,slug=?,description=?,brand=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'ACTIVE'").bind(category,name,slug,text(data.description,5000)||null,text(data.brand,120)||null,id)
        :env.DB.prepare("INSERT INTO products (id,category_id,name,slug,description,brand,status) VALUES (?,?,?,?,?,?,'DRAFT')").bind(id,category,name,slug,text(data.description,5000)||null,text(data.brand,120)||null);
      await recordCatalogAudit(mutation,"PRODUCT",id,before?"PRODUCT_UPDATED":"PRODUCT_CREATED",before,"products",["id","category_id","name","slug","description","brand","status","updated_at"]);
      return json({success:true,product:await env.DB.prepare("SELECT * FROM products WHERE id=?").bind(id).first()},before?200:201);
    }
    if(data.operation==="save_variant"){
      const id=text(data.id,100)||crypto.randomUUID(),pid=text(data.product_id,100),sku=text(data.sku,120).toUpperCase(),name=text(data.variant_name,180);
      if(!pid||!/^[A-Z0-9][A-Z0-9._-]{1,119}$/.test(sku))return json({success:false,error:"Valid product and SKU are required"},400);
      const product=await env.DB.prepare("SELECT status FROM products WHERE id=?").bind(pid).first();
      if(!product)return json({success:false,error:"Product not found"},404);
      if(product.status==="ACTIVE")return json({success:false,error:"Pause product before editing variants"},409);
      let attrs=null;
      if(data.attributes!==undefined){
        if(!data.attributes||typeof data.attributes!=="object"||Array.isArray(data.attributes)||JSON.stringify(data.attributes).length>2000)return json({success:false,error:"Attributes must be a small JSON object"},400);
        attrs=JSON.stringify(data.attributes);
      }
      const before=await env.DB.prepare("SELECT * FROM product_variants WHERE id=?").bind(id).first();
      if(before&&(before.product_id!==pid||before.status==="ACTIVE"))return json({success:false,error:"Variant identity is immutable; pause product and create a new variant"},409);
      const mutation=before
        ?env.DB.prepare("UPDATE product_variants SET sku=?,variant_name=?,attributes_json=? WHERE id=? AND product_id=? AND status<>'ACTIVE'").bind(sku,name||null,attrs,id,pid)
        :env.DB.prepare("INSERT INTO product_variants (id,product_id,sku,variant_name,attributes_json,status) VALUES (?,?,?,?,?,'DRAFT')").bind(id,pid,sku,name||null,attrs);
      await recordCatalogAudit(mutation,"VARIANT",id,before?"VARIANT_UPDATED":"VARIANT_CREATED",before,"product_variants",["id","product_id","sku","variant_name","attributes_json","status"]);
      return json({success:true,variant:await env.DB.prepare("SELECT * FROM product_variants WHERE id=?").bind(id).first()},before?200:201);
    }
    if(data.operation==="save_price"){
      const id=text(data.id,100)||crypto.randomUUID(),pid=text(data.product_id,100),vid=text(data.variant_id,100)||null,country=text(data.country_code,2).toUpperCase(),currency=text(data.currency_code,3).toUpperCase(),price=integer(data.price_minor,1,Number.MAX_SAFE_INTEGER);
      const compare=data.compare_at_price_minor==null||data.compare_at_price_minor===""?null:integer(data.compare_at_price_minor,price||1,Number.MAX_SAFE_INTEGER);
      if(!pid||!/^[A-Z]{2}$/.test(country)||!/^[A-Z]{3}$/.test(currency)||price===null||(data.compare_at_price_minor!=null&&data.compare_at_price_minor!==""&&compare===null))return json({success:false,error:"Valid product, market and minor-unit price are required"},400);
      const product=await env.DB.prepare("SELECT id FROM products WHERE id=?").bind(pid).first();
      const market=await env.DB.prepare("SELECT co.is_active,cu.is_active AS currency_active FROM countries co JOIN currencies cu ON cu.code=co.currency_code WHERE co.country_code=? AND co.currency_code=?").bind(country,currency).first();
      const variant=vid?await env.DB.prepare("SELECT id FROM product_variants WHERE id=? AND product_id=?").bind(vid,pid).first():true;
      if(!product||!market||!variant)return json({success:false,error:"Product, market or variant relationship is invalid"},409);
      if(!market.is_active||!market.currency_active)return json({success:false,error:"Market and currency must be active"},409);
      const from=text(data.valid_from,40)||null,until=text(data.valid_until,40)||null;
      if((from&&Number.isNaN(Date.parse(from)))||(until&&Number.isNaN(Date.parse(until)))||(from&&until&&Date.parse(until)<=Date.parse(from)))return json({success:false,error:"Invalid price validity window"},400);
      const before=data.id?await env.DB.prepare("SELECT * FROM product_prices WHERE id=?").bind(id).first():null;
      if(data.id&&!before)return json({success:false,error:"Price not found"},404);
      if(before&&before.status==="ACTIVE")return json({success:false,error:"Active prices cannot be edited; deactivate the price first"},409);
      if(before&&(before.product_id!==pid))return json({success:false,error:"Price product identity cannot be changed"},409);
      const mutation=before
        ?env.DB.prepare("UPDATE product_prices SET variant_id=?,country_code=?,currency_code=?,price_minor=?,compare_at_price_minor=?,valid_from=?,valid_until=? WHERE id=? AND status<>'ACTIVE'").bind(vid,country,currency,price,compare,from,until,id)
        :env.DB.prepare("INSERT INTO product_prices (id,product_id,variant_id,country_code,currency_code,price_minor,compare_at_price_minor,status,valid_from,valid_until) VALUES (?,?,?,?,?,?,?,'PENDING',?,?)").bind(id,pid,vid,country,currency,price,compare,from,until);
      await recordCatalogAudit(mutation,"PRICE",id,before?"PRICE_UPDATED":"PRICE_CREATED_PENDING",before,"product_prices",["id","product_id","variant_id","country_code","currency_code","price_minor","compare_at_price_minor","status","valid_from","valid_until"]);
      return json({success:true,price:await env.DB.prepare("SELECT * FROM product_prices WHERE id=?").bind(id).first()},before?200:201);
    }

    if(data.operation==="set_variant_status"){
      const id=text(data.id,100),status=text(data.status,20).toUpperCase();
      if(!id||!["DRAFT","ACTIVE","PAUSED","ARCHIVED"].includes(status))return json({success:false,error:"Valid variant and status are required"},400);
      const before=await env.DB.prepare("SELECT * FROM product_variants WHERE id=?").bind(id).first();
      if(!before)return json({success:false,error:"Variant not found"},404);
      const product=await env.DB.prepare("SELECT status FROM products WHERE id=?").bind(before.product_id).first();
      if(status==="ACTIVE"&&(!product||product.status==="ARCHIVED"))return json({success:false,error:"Archived products cannot have active variants"},409);
      const mutation=env.DB.prepare("UPDATE product_variants SET status=? WHERE id=? AND status=?").bind(status,id,before.status);
      await recordCatalogAudit(mutation,"VARIANT",id,"VARIANT_STATUS_CHANGED",before,"product_variants",["id","product_id","sku","variant_name","attributes_json","status"]);
      return json({success:true,id,status});
    }
    if(data.operation==="set_price_status"){
      const id=text(data.id,100),status=text(data.status,20).toUpperCase();
      if(!id||!["PENDING","ACTIVE","INACTIVE"].includes(status))return json({success:false,error:"Valid price and status are required"},400);
      const before=await env.DB.prepare("SELECT * FROM product_prices WHERE id=?").bind(id).first();
      if(!before)return json({success:false,error:"Price not found"},404);
      if(status==="ACTIVE"){
        const eligible=await env.DB.prepare("SELECT 1 AS ok FROM product_prices pp JOIN products p ON p.id=pp.product_id JOIN categories c ON c.id=p.category_id AND c.is_active=1 JOIN countries co ON co.country_code=pp.country_code AND co.currency_code=pp.currency_code AND co.is_active=1 JOIN currencies cu ON cu.code=pp.currency_code AND cu.is_active=1 WHERE pp.id=? AND p.status<>'ARCHIVED' AND (pp.variant_id IS NULL OR EXISTS (SELECT 1 FROM product_variants v WHERE v.id=pp.variant_id AND v.product_id=p.id AND v.status='ACTIVE')) AND (pp.valid_from IS NULL OR datetime(pp.valid_from)<=datetime('now')) AND (pp.valid_until IS NULL OR datetime(pp.valid_until)>datetime('now'))")
          .bind(id).first();
        if(!eligible)return json({success:false,error:"Product category, market, variant or price validity is not eligible"},409);
      }
      const mutation=env.DB.prepare("UPDATE product_prices SET status=? WHERE id=? AND status=?").bind(status,id,before.status);
      await recordCatalogAudit(mutation,"PRICE",id,"PRICE_STATUS_CHANGED",before,"product_prices",["id","product_id","variant_id","country_code","currency_code","price_minor","compare_at_price_minor","status","valid_from","valid_until"]);
      return json({success:true,id,status});
    }
    if(data.operation==="set_product_status"){
      const id=text(data.id,100),status=text(data.status,20).toUpperCase(),country=text(data.country_code,2).toUpperCase(),currency=text(data.currency_code,3).toUpperCase();
      if(!id||!["DRAFT","ACTIVE","PAUSED","ARCHIVED"].includes(status))return json({success:false,error:"Valid product and status are required"},400);
      const before=await env.DB.prepare("SELECT * FROM products WHERE id=?").bind(id).first();
      if(!before)return json({success:false,error:"Product not found"},404);
      if(status==="ACTIVE"){
        if(!/^[A-Z]{2}$/.test(country)||!/^[A-Z]{3}$/.test(currency))return json({success:false,error:"Country and currency are required for activation"},400);
        const age=integer(env.HR_INVENTORY_MAX_AGE_HOURS,1,72)||72;
        const ready=await env.DB.prepare("SELECT 1 AS ok FROM products p JOIN categories c ON c.id=p.category_id AND c.is_active=1 JOIN countries co ON co.country_code=? AND co.currency_code=? AND co.is_active=1 JOIN currencies cu ON cu.code=? AND cu.is_active=1 WHERE p.id=? AND EXISTS (SELECT 1 FROM product_variants v JOIN inventory i ON i.variant_id=v.id AND i.product_id=p.id AND i.quantity>0 JOIN warehouses w ON w.id=i.warehouse_id AND w.country_code=co.country_code AND w.status='ACTIVE' WHERE v.product_id=p.id AND v.status='ACTIVE' AND i.verified_at IS NOT NULL AND datetime(i.verified_at)>=datetime('now',?) AND datetime(i.verified_at)<=CURRENT_TIMESTAMP) AND EXISTS (SELECT 1 FROM product_prices pp WHERE pp.product_id=p.id AND pp.country_code=co.country_code AND pp.currency_code=co.currency_code AND pp.variant_id IS NULL AND pp.status='ACTIVE' AND (pp.valid_from IS NULL OR datetime(pp.valid_from)<=datetime('now')) AND (pp.valid_until IS NULL OR datetime(pp.valid_until)>datetime('now')))")
          .bind(country,currency,currency,id,"-"+age+" hours").first();
        if(!ready)return json({success:false,error:"Activation requires active category and market, fresh verified warehouse stock, an active variant and valid active market price"},409);
      }
      const mutation=env.DB.prepare("UPDATE products SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=?").bind(status,id,before.status);
      await recordCatalogAudit(mutation,"PRODUCT",id,"PRODUCT_STATUS_CHANGED",before,"products",["id","category_id","name","slug","description","brand","status","updated_at"]);
      return json({success:true,id,status});
    }
    return json({success:false,error:"Unknown catalog operation"},400);
  }catch(error){
    if(/UNIQUE constraint failed|FOREIGN KEY constraint failed|CHECK constraint failed/.test(error?.message||""))return json({success:false,error:"Catalog change conflicts with a database rule"},409);
    console.error("Catalog admin mutation failed:",error);return json({success:false,error:"Unable to save catalog change"},500);
  }
}

async function manageInventoryVerification(request, env) {
  if (!env.DB) return json({ success: false, error: "Database connection unavailable" }, 503);
  if (!env.HR_ADMIN_API_TOKEN) return json({ success: false, error: "Owner inventory access is not configured" }, 503);
  const authorization = request.headers.get("Authorization") || "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!constantTimeEqual(suppliedToken, env.HR_ADMIN_API_TOKEN)) return json({ success: false, error: "Unauthorized" }, 401);

  try {
    if (request.method === "GET") {
      const maxAgeHours = integer(env.HR_INVENTORY_MAX_AGE_HOURS, 1, 72) || 72;
      const result = await env.DB.prepare(`SELECT i.id AS inventory_id, i.product_id, p.name AS product_name,
        i.variant_id, pv.sku, pv.variant_name, i.warehouse_id, w.warehouse_name,
        w.city, i.quantity AS available_quantity,
        COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r
          WHERE r.inventory_id = i.id AND r.status = 'RESERVED'), 0) AS reserved_quantity,
        i.verified_at, i.updated_at,
        CASE WHEN i.verified_at IS NULL OR datetime(i.verified_at) < datetime('now', ?)
          OR datetime(i.verified_at) > CURRENT_TIMESTAMP
          THEN 1 ELSE 0 END AS is_stale,
        (SELECT e.created_at FROM inventory_verification_events e
          WHERE e.inventory_id = i.id ORDER BY e.created_at DESC LIMIT 1) AS last_verification_event_at
        FROM inventory i
        JOIN products p ON p.id = i.product_id
        JOIN product_variants pv ON pv.id = i.variant_id AND pv.product_id = i.product_id
        JOIN warehouses w ON w.id = i.warehouse_id
        WHERE w.country_code = 'BD'
        ORDER BY is_stale DESC, i.updated_at DESC LIMIT 200`).bind(
          `-${maxAgeHours} hours`
        ).all();
      return json({ success: true, inventory_max_age_hours: maxAgeHours, inventory: result.results || [] });
    }
    if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

    let data;
    try {
      const raw = await request.text();
      if (raw.length > 5000) return json({ success: false, error: "Request too large" }, 413);
      data = JSON.parse(raw);
    } catch {
      return json({ success: false, error: "Invalid JSON request" }, 400);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return json({ success: false, error: "Invalid inventory verification" }, 400);
    }

    const inventoryId = text(data.inventory_id, 100);
    const physicalQuantity = integer(data.physical_quantity, 0, 1000000);
    const evidence = text(data.evidence_reference, 500);
    const notes = text(data.notes, 1000) || null;
    if (!inventoryId || physicalQuantity === null || !evidence) {
      return json({ success: false, error: "inventory_id, a non-negative physical count and evidence reference are required" }, 400);
    }

    const current = await env.DB.prepare(`SELECT i.id, i.quantity, i.verified_at, w.country_code,
      COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r
        WHERE r.inventory_id = i.id AND r.status = 'RESERVED'), 0) AS reserved_quantity
      FROM inventory i JOIN warehouses w ON w.id = i.warehouse_id
      WHERE i.id = ?`).bind(inventoryId).first();
    if (!current) return json({ success: false, error: "Inventory row not found" }, 404);
    if (current.country_code !== "BD") return json({ success: false, error: "This verification workflow is limited to Bangladesh inventory" }, 409);

    const reserved = Number(current.reserved_quantity || 0);
    if (!Number.isSafeInteger(reserved) || reserved < 0 || physicalQuantity < reserved) {
      return json({ success: false, error: "Physical count cannot be lower than units already reserved for customer orders" }, 409);
    }
    const availableQuantity = physicalQuantity - reserved;
    const verificationId = crypto.randomUUID();
    const verifiedAt = new Date().toISOString();
    const actor = text(env.HR_ADMIN_OWNER_LABEL, 80) || "OWNER";

    const statements = await env.DB.batch([
      env.DB.prepare(`UPDATE inventory
        SET quantity = ?, verified_at = ?, updated_at = ?, verification_token = ?
        WHERE id = ? AND quantity = ? AND verified_at IS ?`).bind(
          availableQuantity, verifiedAt, verifiedAt, verificationId,
          inventoryId, Number(current.quantity), current.verified_at ?? null
        ),
      env.DB.prepare(`INSERT INTO inventory_verification_events
        (id, inventory_id, previous_available_quantity, verified_physical_quantity,
         reserved_quantity, new_available_quantity, evidence_reference, notes, verified_by)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM inventory
          WHERE id = ? AND verification_token = ? AND quantity = ?
        )`).bind(
          verificationId, inventoryId, Number(current.quantity), physicalQuantity,
          reserved, availableQuantity, evidence, notes, actor,
          inventoryId, verificationId, availableQuantity
        )
    ]);

    if (!statements[0]?.meta || statements[0].meta.changes !== 1) {
      return json({ success: false, error: "Inventory changed during verification; refresh and retry" }, 409);
    }
    if (!statements[1]?.meta || statements[1].meta.changes !== 1) {
      return json({ success: false, error: "Inventory verification audit event was not recorded" }, 500);
    }
    return json({ success: true, verification: {
      id: verificationId, inventory_id: inventoryId,
      previous_available_quantity: Number(current.quantity),
      physical_quantity: physicalQuantity, reserved_quantity: reserved,
      available_quantity: availableQuantity, verified_at: verifiedAt
    } }, 201);
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error?.message || error))) {
      return json({ success: false, error: "This evidence reference was already used for this inventory row" }, 409);
    }
    console.error("Inventory verification failed:", error);
    return json({ success: false, error: "Unable to save inventory verification" }, 500);
  }
}

async function manageBangladeshCodLedger(request, env) {
  if (!env.DB) return json({ success: false, error: "Database connection unavailable" }, 503);
  if (!env.HR_ADMIN_API_TOKEN) return json({ success: false, error: "Owner COD ledger access is not configured" }, 503);
  const authorization = request.headers.get("Authorization") || "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!constantTimeEqual(suppliedToken, env.HR_ADMIN_API_TOKEN)) return json({ success: false, error: "Unauthorized" }, 401);

  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const orderId = text(url.searchParams.get("order_id"), 100);
      const status = text(url.searchParams.get("status"), 30).toUpperCase();
      if (status && !["PENDING_REVIEW","VERIFIED","DISPUTED"].includes(status)) {
        return json({ success: false, error: "Invalid ledger review status" }, 400);
      }
      const clauses = ["o.country_code = 'BD'", "o.currency_code = 'BDT'", "o.payment_method = 'COD'"];
      const values = [];
      if (orderId) { clauses.push("e.order_id = ?"); values.push(orderId); }
      if (status) { clauses.push("e.status = ?"); values.push(status); }
      const result = await env.DB.prepare(`SELECT e.id, e.order_id, e.entry_type, e.amount_minor,
        e.currency_code, e.status, e.source_reference, e.evidence_reference, e.notes,
        e.occurred_at, e.recorded_by, e.reviewed_by, e.reviewed_at, e.review_note, e.created_at
        FROM cod_reconciliation_entries e JOIN orders o ON o.id = e.order_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY e.occurred_at DESC, e.created_at DESC LIMIT 200`).bind(...values).all();
      return json({ success: true, entries: result.results || [] });
    }
    if (request.method !== "POST" && request.method !== "PATCH") {
      return json({ success: false, error: "Method not allowed" }, 405);
    }

    let data;
    try {
      const raw = await request.text();
      if (raw.length > 6000) return json({ success: false, error: "Request too large" }, 413);
      data = JSON.parse(raw);
    } catch {
      return json({ success: false, error: "Invalid JSON request" }, 400);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return json({ success: false, error: "Invalid ledger request" }, 400);
    if (request.method !== "POST" && request.method !== "PATCH") return json({ success: false, error: "Method not allowed" }, 405);

    if (request.method === "POST") {
      const orderId = text(data.order_id, 100);
      const entryType = text(data.entry_type, 40).toUpperCase();
      const allowedTypes = ["CUSTOMER_COD_COLLECTED","COURIER_SETTLEMENT_RECEIVED","COURIER_FEE","RETURN_FEE","CUSTOMER_REFUND","ADJUSTMENT_IN","ADJUSTMENT_OUT"];
      const amount = integer(data.amount_minor, 1, Number.MAX_SAFE_INTEGER);
      const evidence = text(data.evidence_reference, 500);
      const source = text(data.source_reference, 160) || null;
      const notes = text(data.notes, 1000) || null;
      const occurredAt = text(data.occurred_at, 40) || new Date().toISOString();
      if (!orderId || !allowedTypes.includes(entryType) || amount === null || !evidence || !Number.isFinite(Date.parse(occurredAt))) {
        return json({ success: false, error: "A valid order, entry type, positive BDT amount, evidence reference and occurrence date are required" }, 400);
      }
      const order = await env.DB.prepare(`SELECT id, country_code, currency_code, payment_method, delivery_status, total_minor
        FROM orders WHERE id = ?`).bind(orderId).first();
      if (!order) return json({ success: false, error: "Order not found" }, 404);
      if (order.country_code !== "BD" || order.currency_code !== "BDT" || order.payment_method !== "COD") {
        return json({ success: false, error: "Only Bangladesh BDT COD orders can use this ledger" }, 409);
      }
      if (entryType === "CUSTOMER_COD_COLLECTED" && order.delivery_status !== "DELIVERED") {
        return json({ success: false, error: "Record customer COD collection only after delivery is marked DELIVERED" }, 409);
      }
      if (entryType === "CUSTOMER_COD_COLLECTED" && !Number.isSafeInteger(Number(order.total_minor))) {
        return json({ success: false, error: "Order total is unavailable for COD reconciliation" }, 409);
      }
      const id = crypto.randomUUID();
      const insertColumns = `(id, order_id, entry_type, amount_minor, currency_code, status, source_reference,
        evidence_reference, notes, occurred_at, recorded_by)`;
      const insertSelect = `INSERT INTO cod_reconciliation_entries ${insertColumns}
        SELECT ?, ?, ?, ?, 'BDT', 'PENDING_REVIEW', ?, ?, ?, ?, ?`;
      let insertSql = insertSelect;
      let insertValues = [id, orderId, entryType, amount, source, evidence, notes, occurredAt,
        text(env.HR_ADMIN_OWNER_LABEL, 80) || "OWNER"];
      if (entryType === "CUSTOMER_COD_COLLECTED") {
        // The total cap is enforced inside the INSERT statement itself, so two
        // simultaneous operator requests cannot both pass a stale pre-check.
        insertSql += ` WHERE EXISTS (
          SELECT 1 FROM orders o WHERE o.id = ? AND o.delivery_status = 'DELIVERED'
            AND o.total_minor >= ? + COALESCE((
              SELECT SUM(amount_minor) FROM cod_reconciliation_entries
              WHERE order_id = o.id AND entry_type = 'CUSTOMER_COD_COLLECTED'
            ), 0)
        )`;
        insertValues.push(orderId, amount);
      } else if (entryType === "COURIER_SETTLEMENT_RECEIVED") {
        // Settlement cannot exceed verified customer collections. The check
        // is part of the insert to avoid concurrent over-settlement.
        insertSql += ` WHERE ? + COALESCE((
          SELECT SUM(amount_minor) FROM cod_reconciliation_entries
          WHERE order_id = ? AND entry_type = 'COURIER_SETTLEMENT_RECEIVED'
        ), 0) <= COALESCE((
          SELECT SUM(amount_minor) FROM cod_reconciliation_entries
          WHERE order_id = ? AND entry_type = 'CUSTOMER_COD_COLLECTED' AND status = 'VERIFIED'
        ), 0)`;
        insertValues.push(amount, orderId, orderId);
      } else if (entryType === "CUSTOMER_REFUND") {
        // Refunds must not exceed verified COD collected; all prior refund
        // records count conservatively, including those still under review.
        insertSql += ` WHERE ? + COALESCE((
          SELECT SUM(amount_minor) FROM cod_reconciliation_entries
          WHERE order_id = ? AND entry_type = 'CUSTOMER_REFUND'
        ), 0) <= COALESCE((
          SELECT SUM(amount_minor) FROM cod_reconciliation_entries
          WHERE order_id = ? AND entry_type = 'CUSTOMER_COD_COLLECTED' AND status = 'VERIFIED'
        ), 0)`;
        insertValues.push(amount, orderId, orderId);
      } else {
        insertSql = `INSERT INTO cod_reconciliation_entries ${insertColumns}
          VALUES (?, ?, ?, ?, 'BDT', 'PENDING_REVIEW', ?, ?, ?, ?, ?)`;
      }
      let inserted;
      try {
        inserted = await env.DB.prepare(insertSql).bind(...insertValues).run();
      } catch (error) {
        if (/UNIQUE constraint failed/i.test(String(error?.message || error))) {
          return json({ success: false, error: "This source reference is already recorded for this order and entry type" }, 409);
        }
        throw error;
      }
      if (!inserted.meta || inserted.meta.changes !== 1) {
        const message = entryType === "CUSTOMER_COD_COLLECTED"
          ? "Customer COD collection entries cannot exceed the server-calculated order total"
          : entryType === "COURIER_SETTLEMENT_RECEIVED"
            ? "Courier settlement cannot exceed recorded customer COD collection"
            : entryType === "CUSTOMER_REFUND"
              ? "Customer refunds cannot exceed verified customer COD collection"
              : "Ledger entry could not be saved";
        return json({ success: false, error: message }, 409);
      }
      return json({ success: true, entry: { id, order_id: orderId, entry_type: entryType, amount_minor: amount, currency_code: "BDT", status: "PENDING_REVIEW" } }, 201);
    }

    if (request.method === "PATCH") {
      const entryId = text(data.entry_id, 100);
      const target = text(data.status, 30).toUpperCase();
      const reviewNote = text(data.review_note, 1000) || null;
      if (!entryId || !["VERIFIED","DISPUTED"].includes(target)) return json({ success: false, error: "entry_id and VERIFIED or DISPUTED status are required" }, 400);
      const result = await env.DB.prepare(`UPDATE cod_reconciliation_entries
        SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ?
        WHERE id = ? AND status = 'PENDING_REVIEW'
          AND EXISTS (
            SELECT 1 FROM orders o
            WHERE o.id = cod_reconciliation_entries.order_id
              AND o.country_code = 'BD' AND o.currency_code = 'BDT' AND o.payment_method = 'COD'
          )`).bind(
          target, text(env.HR_ADMIN_OWNER_LABEL, 80) || "OWNER", reviewNote, entryId
        ).run();
      if (!result.meta || result.meta.changes !== 1) return json({ success: false, error: "Entry not found or already reviewed; refresh and retry" }, 409);
      return json({ success: true, entry_id: entryId, status: target });
    }
    return json({ success: false, error: "Method not allowed" }, 405);
  } catch (error) {
    console.error("Bangladesh COD ledger operation failed:", error);
    return json({ success: false, error: "Unable to process COD ledger request" }, 500);
  }
}

async function manageBangladeshReturnInspections(request, env) {
  if (!env.DB) return json({ success: false, error: "Database connection unavailable" }, 503);
  if (!env.HR_ADMIN_API_TOKEN) return json({ success: false, error: "Owner return inspection access is not configured" }, 503);
  const authorization = request.headers.get("Authorization") || "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!constantTimeEqual(suppliedToken, env.HR_ADMIN_API_TOKEN)) return json({ success: false, error: "Unauthorized" }, 401);

  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const orderId = text(url.searchParams.get("order_id"), 100);
      const result = orderId
        ? await env.DB.prepare(`SELECT i.* FROM order_return_inspections i
            JOIN orders o ON o.id = i.order_id
            WHERE i.order_id = ? AND o.country_code = 'BD' AND o.currency_code = 'BDT'
              AND o.payment_method = 'COD' ORDER BY i.created_at DESC LIMIT 100`).bind(orderId).all()
        : await env.DB.prepare(`SELECT i.* FROM order_return_inspections i
            JOIN orders o ON o.id = i.order_id
            WHERE o.country_code = 'BD' AND o.currency_code = 'BDT'
              AND o.payment_method = 'COD' ORDER BY i.created_at DESC LIMIT 200`).all();
      return json({ success: true, inspections: result.results || [] });
    }
    if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
    let data;
    try {
      const raw = await request.text();
      if (raw.length > 5000) return json({ success: false, error: "Request too large" }, 413);
      data = JSON.parse(raw);
    } catch {
      return json({ success: false, error: "Invalid JSON request" }, 400);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return json({ success: false, error: "Invalid return inspection" }, 400);
    const orderId = text(data.order_id, 100);
    const condition = text(data.parcel_condition, 30).toUpperCase();
    const disposition = text(data.disposition, 30).toUpperCase();
    const quantity = integer(data.inspected_quantity, 1, 10000);
    const notes = text(data.notes, 2000);
    const evidence = text(data.evidence_reference, 500) || null;
    const conditions = ["SEALED_INTACT","OPENED_INTACT","DAMAGED","INCOMPLETE","WRONG_ITEM","MISSING"];
    const dispositions = ["QUARANTINE","RESTOCK_CANDIDATE","RETURN_TO_SUPPLIER","DISPOSE","INVESTIGATE"];
    if (!orderId || !conditions.includes(condition) || !dispositions.includes(disposition) || quantity === null || !notes) {
      return json({ success: false, error: "Valid order, parcel condition, disposition, inspected quantity and notes are required" }, 400);
    }
    if (disposition === "RESTOCK_CANDIDATE" && !["SEALED_INTACT","OPENED_INTACT"].includes(condition)) {
      return json({ success: false, error: "Damaged, incomplete, wrong or missing parcels cannot be marked as restock candidates" }, 409);
    }
    const order = await env.DB.prepare(`SELECT o.id, o.country_code, o.currency_code, o.payment_method, o.delivery_status
      FROM orders o WHERE o.id = ?`).bind(orderId).first();
    if (!order) return json({ success: false, error: "Order not found" }, 404);
    if (order.country_code !== "BD" || order.currency_code !== "BDT" || order.payment_method !== "COD" || order.delivery_status !== "RETURNED") {
      return json({ success: false, error: "Return inspection is only available for returned Bangladesh BDT COD orders" }, 409);
    }
    const id = crypto.randomUUID();
    // Enforce cumulative inspected quantity in the INSERT itself. A separate
    // read-then-write check could be bypassed by simultaneous operator requests.
    const inserted = await env.DB.prepare(`INSERT INTO order_return_inspections
      (id, order_id, parcel_condition, disposition, inspected_quantity, notes, evidence_reference, inspected_by)
      SELECT ?, o.id, ?, ?, ?, ?, ?, ?
      FROM orders o
      WHERE o.id = ? AND o.country_code = 'BD' AND o.currency_code = 'BDT'
        AND o.payment_method = 'COD' AND o.delivery_status = 'RETURNED'
        AND ? + COALESCE((
          SELECT SUM(inspected_quantity) FROM order_return_inspections
          WHERE order_id = o.id
        ), 0) <= COALESCE((
          SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id
        ), o.quantity, 0)
    `).bind(
      id, condition, disposition, quantity, notes, evidence,
      text(env.HR_ADMIN_OWNER_LABEL, 80) || "OWNER", orderId, quantity
    ).run();
    if (!inserted.meta || inserted.meta.changes !== 1) {
      return json({ success: false, error: "Cumulative inspected quantity cannot exceed the order quantity; refresh and verify the returned order" }, 409);
    }
    return json({ success: true, inspection: { id, order_id: orderId, parcel_condition: condition, disposition, inspected_quantity: quantity, inventory_changed: false } }, 201);
  } catch (error) {
    console.error("Bangladesh return inspection failed:", error);
    return json({ success: false, error: "Unable to process return inspection" }, 500);
  }
}

async function manageBangladeshCodDelivery(request, env) {
  if (!env.DB) return json({ success: false, error: "Database connection unavailable" }, 503);
  if (!env.HR_ADMIN_API_TOKEN) return json({ success: false, error: "Owner delivery access is not configured" }, 503);
  const authorization = request.headers.get("Authorization") || "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!constantTimeEqual(suppliedToken, env.HR_ADMIN_API_TOKEN)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  if (request.method === "GET") {
    try {
      const url = new URL(request.url);
      const status = text(url.searchParams.get("delivery_status"), 30).toUpperCase();
      const allowed = ["NOT_DISPATCHED","READY_TO_SHIP","SHIPPED","IN_TRANSIT","OUT_FOR_DELIVERY","DELIVERED","DELIVERY_FAILED","RETURNED"];
      if (status && !allowed.includes(status)) return json({ success: false, error: "Invalid delivery status filter" }, 400);
      const result = status
        ? await env.DB.prepare(`SELECT id, product_name, quantity, customer_name, customer_phone, customer_address,
            district, total_minor, currency_code, payment_method, status, delivery_status, courier_name,
            courier_service, consignment_id, tracking_url, cod_amount_minor, cod_collected_minor,
            delivered_at, delivery_notes, created_at
            FROM orders WHERE country_code = 'BD' AND currency_code = 'BDT' AND payment_method = 'COD'
            AND delivery_status = ? ORDER BY created_at DESC LIMIT 100`).bind(status).all()
        : await env.DB.prepare(`SELECT id, product_name, quantity, customer_name, customer_phone, customer_address,
            district, total_minor, currency_code, payment_method, status, delivery_status, courier_name,
            courier_service, consignment_id, tracking_url, cod_amount_minor, cod_collected_minor,
            delivered_at, delivery_notes, created_at
            FROM orders WHERE country_code = 'BD' AND currency_code = 'BDT' AND payment_method = 'COD'
            ORDER BY created_at DESC LIMIT 100`).all();
      return json({ success: true, orders: result.results || [] });
    } catch (error) {
      console.error("Bangladesh COD delivery list failed:", error);
      return json({ success: false, error: "Unable to load Bangladesh COD delivery orders" }, 500);
    }
  }

  if (request.method !== "PATCH") return json({ success: false, error: "Method not allowed" }, 405);
  let data;
  try {
    const raw = await request.text();
    if (raw.length > 8000) return json({ success: false, error: "Request too large" }, 413);
    data = JSON.parse(raw);
  } catch {
    return json({ success: false, error: "Invalid JSON request" }, 400);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return json({ success: false, error: "Invalid delivery update" }, 400);
  }

  const orderId = text(data.order_id, 100);
  if (!orderId) return json({ success: false, error: "order_id is required" }, 400);
  const nextStatus = data.delivery_status === undefined ? null : text(data.delivery_status, 30).toUpperCase();
  const allowed = ["NOT_DISPATCHED","READY_TO_SHIP","SHIPPED","IN_TRANSIT","OUT_FOR_DELIVERY","DELIVERED","DELIVERY_FAILED","RETURNED"];
  if (nextStatus && !allowed.includes(nextStatus)) return json({ success: false, error: "Invalid delivery status" }, 400);

  const fields = {
    courier_name: data.courier_name === undefined ? undefined : text(data.courier_name, 100),
    courier_service: data.courier_service === undefined ? undefined : text(data.courier_service, 100),
    consignment_id: data.consignment_id === undefined ? undefined : text(data.consignment_id, 150),
    tracking_url: data.tracking_url === undefined ? undefined : text(data.tracking_url, 1000),
    delivery_notes: data.delivery_notes === undefined ? undefined : text(data.delivery_notes, 1000)
  };
  if (fields.tracking_url) {
    try {
      const parsed = new URL(fields.tracking_url);
      if (parsed.protocol !== "https:") throw new Error("HTTPS required");
    } catch {
      return json({ success: false, error: "Tracking URL must be a valid HTTPS URL" }, 400);
    }
  }
  const supplied = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (!nextStatus && supplied.length === 0) return json({ success: false, error: "No delivery changes supplied" }, 400);

  try {
    const before = await env.DB.prepare(`SELECT id, status, country_code, currency_code, payment_method,
      total_minor, delivery_status, courier_name, courier_service, consignment_id, tracking_url,
      delivery_notes FROM orders WHERE id = ?`).bind(orderId).first();
    if (!before) return json({ success: false, error: "Order not found" }, 404);
    if (before.country_code !== "BD" || before.currency_code !== "BDT" || before.payment_method !== "COD") {
      return json({ success: false, error: "Only Bangladesh BDT COD orders can enter this delivery workflow" }, 409);
    }
    if (["CANCELLED","REJECTED"].includes(before.status)) {
      return json({ success: false, error: "Cancelled or rejected orders cannot be dispatched" }, 409);
    }
    const currentStatus = before.delivery_status || "NOT_DISPATCHED";
    const transitions = {
      NOT_DISPATCHED: ["READY_TO_SHIP"],
      READY_TO_SHIP: ["SHIPPED","NOT_DISPATCHED"],
      SHIPPED: ["IN_TRANSIT","OUT_FOR_DELIVERY","DELIVERY_FAILED","RETURNED"],
      IN_TRANSIT: ["OUT_FOR_DELIVERY","DELIVERY_FAILED","RETURNED"],
      OUT_FOR_DELIVERY: ["DELIVERED","DELIVERY_FAILED","RETURNED"],
      DELIVERY_FAILED: ["READY_TO_SHIP","RETURNED"],
      DELIVERED: [],
      RETURNED: []
    };
    if (nextStatus && nextStatus !== currentStatus && !(transitions[currentStatus] || []).includes(nextStatus)) {
      return json({ success: false, error: "Invalid delivery status transition", current_status: currentStatus }, 409);
    }
    if (nextStatus === "SHIPPED" && !fields.courier_name && !before.courier_name) {
      return json({ success: false, error: "Assign a courier before marking the parcel as shipped" }, 400);
    }

    const updates = [];
    const values = [];
    if (nextStatus && nextStatus !== currentStatus) {
      updates.push("delivery_status = ?");
      values.push(nextStatus);
    }
    for (const [key, value] of supplied) {
      if (value !== before[key]) {
        updates.push(key + " = ?");
        values.push(value || null);
      }
    }
    if (updates.length === 0) return json({ success: true, unchanged: true, order_id: orderId });
    // Use a unique timestamp as a conditional audit marker. D1 batch is
    // transactional: the order update and its event either both commit or
    // both roll back. The INSERT ... SELECT only writes an event when this
    // exact conditional update changed the order.
    const auditTimestamp = new Date().toISOString();
    updates.push("delivery_updated_at = ?");
    values.push(auditTimestamp);
    if (nextStatus === "DELIVERED" && currentStatus !== "DELIVERED") updates.push("delivered_at = CURRENT_TIMESTAMP");
    if (before.total_minor !== null && before.total_minor !== undefined) {
      updates.push("cod_amount_minor = COALESCE(cod_amount_minor, ?)");
      values.push(before.total_minor);
    }
    values.push(orderId, currentStatus);

    const eventType = supplied.some(([key]) => ["courier_name","courier_service"].includes(key))
      ? "COURIER_ASSIGNED"
      : supplied.some(([key]) => ["consignment_id","tracking_url"].includes(key))
        ? "TRACKING_UPDATED"
        : nextStatus && nextStatus !== currentStatus ? "DELIVERY_STATUS_CHANGED" : "DELIVERY_NOTE";
    const event = {
      previous: currentStatus,
      next: nextStatus || currentStatus,
      changes: Object.fromEntries(supplied.map(([key, value]) => [key, value || null]))
    };
    const eventId = crypto.randomUUID();
    const statements = await env.DB.batch([
      env.DB.prepare(
        `UPDATE orders SET ${updates.join(", ")} WHERE id = ? AND COALESCE(delivery_status, 'NOT_DISPATCHED') = ?`
      ).bind(...values),
      env.DB.prepare(`INSERT INTO order_delivery_events
        (id, order_id, event_type, previous_value, new_value, note, actor)
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM orders WHERE id = ? AND delivery_updated_at = ?
        )`).bind(
          eventId, orderId, eventType, currentStatus, JSON.stringify(event),
          fields.delivery_notes || null, text(env.HR_ADMIN_OWNER_LABEL, 80) || "OWNER",
          orderId, auditTimestamp
        )
    ]);
    if (!statements[0]?.meta || statements[0].meta.changes !== 1) {
      return json({ success: false, error: "Order delivery data changed; refresh and retry" }, 409);
    }
    if (!statements[1]?.meta || statements[1].meta.changes !== 1) {
      // This should be impossible when the conditional update succeeded;
      // return an error rather than reporting an unaudited delivery change.
      return json({ success: false, error: "Delivery audit event was not recorded" }, 500);
    }

    return json({
      success: true,
      message: "Delivery record updated. Courier booking, live tracking and COD payout are not performed by this manual record.",
      order_id: orderId,
      delivery_status: nextStatus || currentStatus,
      cod_collected_minor_changed: false
    });
  } catch (error) {
    console.error("Bangladesh COD delivery update failed:", error);
    return json({ success: false, error: "Unable to update delivery record" }, 500);
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

    if (path === "/api/admin/orders/cancel") return cancelPendingOrder(request, env);

    if (path === "/api/admin/orders/delivery") return manageBangladeshCodDelivery(request, env);
    if (path === "/api/admin/catalog") return manageCatalogAdmin(request, env);
    if (path === "/api/admin/inventory/verification") return manageInventoryVerification(request, env);
    if (path === "/api/admin/orders/cod-ledger") return manageBangladeshCodLedger(request, env);
    if (path === "/api/admin/orders/returns") return manageBangladeshReturnInspections(request, env);

    if (path === "/api/admin/sourcing/offers") return manageSupplierOffers(request, env);

    if (path === "/api/admin/partners/couriers") return manageCourierPartners(request, env);

    if (path === "/api/admin/partners/interactions") return managePartnerInteractions(request, env);

    if (path === "/api/admin/partners/contacts") return managePartnerContacts(request, env);

    if (path === "/api/admin/partners/suppliers") return listLocalSuppliers(request, env);

    if (path === "/api/admin/partners/recommendations") return managePartnerRecommendations(request, env);
    if (path === "/api/admin/partners/service-areas") return manageCourierServiceAreas(request, env);
    if (path === "/api/admin/partners/supplier-profiles") return manageLocalSupplierProfiles(request, env);
    if (path === "/api/admin/partners/supplier-quotes") return manageLocalSupplierQuotes(request, env);
    if (path === "/api/admin/partners/courier-rates") return manageCourierRates(request, env);

    if (path === "/api/admin/sourcing/compare") {
      if (request.method !== "GET") {
        return json({ success: false, error: "Method not allowed" }, 405);
      }
      return compareSupplierOffers(request, env);
    }

    if (path === "/api/categories") {
      if (request.method !== "GET") return json({ success: false, error: "Method not allowed" }, 405);
      return listCategories(request, env);
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
