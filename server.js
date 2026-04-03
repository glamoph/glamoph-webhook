console.log("🚀 GLAMOPH VERIFY (DIRECT RENDER + WEBHOOK)");

const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { Resend } = require("resend");

const { verifyShopifyWebhook } = require("./lib/webhook-verify");
const { readJsonFile, writeJsonFile } = require("./lib/github-contents");
const { syncProductFeaturedImageToGitHub } = require("./lib/image-sync");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const VERIFY_PUBLIC_BASE_URL =
  (process.env.VERIFY_PUBLIC_BASE_URL || "https://verify.glamoph.com").replace(/\/+$/, "");

const ARCHIVE_ASSET_BASE_URL =
  (process.env.ARCHIVE_ASSET_BASE_URL || "https://glamoph.github.io/glamoph-archive").replace(/\/+$/, "");

const resendApiKey = String(process.env.RESEND_API_KEY || "").trim();
const resendFromEmail = String(process.env.RESEND_FROM_EMAIL || "").trim();
const resend = resendApiKey ? new Resend(resendApiKey) : null;

app.get("/", (req, res) => {
  res.send("GLAMOPH Verify System");
});

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function randomSuffix(length = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(length);
  let out = "";

  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }

  return out;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function pad3(value) {
  return String(value).padStart(3, "0");
}

function normalizeMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function parseSku(rawSku = "") {
  const sku = String(rawSku).trim().toUpperCase();

  // GLAMOPH-XXXXXX-S-BLK
  const match = sku.match(/^GLAMOPH-([A-Z0-9]+)-([SML])-(BLK|WHT)$/);

  if (!match) {
    return {
      valid: false,
      sku,
      artworkCode: "",
      sizeCode: "",
      frameCode: "",
    };
  }

  return {
    valid: true,
    sku,
    artworkCode: match[1],
    sizeCode: match[2],
    frameCode: match[3],
  };
}

function resolveEditionTotal(sizeCode) {
  if (sizeCode === "S") return 50;
  if (sizeCode === "M") return 30;
  if (sizeCode === "L") return 10;
  return 50;
}

function resolveSizeLabel(sizeCode) {
  if (sizeCode === "S") return "16 × 20 in (S)";
  if (sizeCode === "M") return "20 × 25 in (M)";
  if (sizeCode === "L") return "24 × 30 in (L)";
  return sizeCode || "";
}

function formatArchiveDate(value) {
  const date = value ? new Date(value) : new Date();

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function getCollectorName(record) {
  const firstName = String(record.customerFirstName || "").trim();
  const lastName = String(record.customerLastName || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();

  if (fullName) return fullName;

  return "";
}

function buildPublicId({ artworkCode, sizeCode, editionNumber }) {
  return `GLA-${artworkCode}-${sizeCode}-${pad3(editionNumber)}`;
}

function buildInternalId(publicId) {
  return `${publicId}-${randomSuffix(8)}`;
}

function resolveRecordImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (/^https?:\/\//i.test(raw)) return raw;

  if (raw.startsWith("/")) {
    return `${ARCHIVE_ASSET_BASE_URL}${raw}`;
  }

  return `${ARCHIVE_ASSET_BASE_URL}/${raw}`;
}

function buildPageHtml(record, recordId, options = {}) {
  const { isOwner } = options;

  const imageUrl = resolveRecordImageUrl(record.image || "");
  const safeTitle = escapeHtml(record.title || "Untitled");
  const safeVerified = escapeHtml(record.verified || "Artwork Verified");
  const safeArtworkId = escapeHtml(record.archiveId || recordId);
  const safeEdition = escapeHtml(record.edition || "");
  const safeArtist = escapeHtml(record.artist || "GLAMOPH");
  const safeMedium = escapeHtml(record.medium || "");
  const safeSize = escapeHtml(record.size || "");
  const safeFrame = escapeHtml(record.frame || "");
  const safeArchiveDate = escapeHtml(record.archiveDate || "");
  const safeArchiveUrl = `${VERIFY_PUBLIC_BASE_URL}/${recordId}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GLAMOPH — ${safeTitle}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500&family=Montserrat:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/archive.css" />
</head>
<body>
  <main class="archive-page">
    <section class="archive-shell">

      <header class="archive-header">
        <div class="archive-status-line">
          <span class="archive-status">${safeVerified}</span>
          ${isOwner ? `<span class="archive-status-divider">/</span><span class="archive-owner">Authenticated Holder</span>` : ""}
        </div>
      </header>

      <section class="archive-hero">
        <div class="archive-hero__content">
          <h1 class="archive-title">${safeTitle}</h1>

          <div class="archive-meta-line">
            <span class="archive-meta-id">${safeArtworkId}</span>
            <span class="archive-meta-divider">/</span>
            <span class="archive-meta-edition" title="Edition number">${safeEdition}</span>
          </div>
        </div>

        <figure class="archive-artwork">
          ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${safeTitle}" />` : ""}
        </figure>
      </section>

      <section class="archive-record">
        <div class="archive-record__inner">
          <div class="archive-record__heading-wrap">
            <h2 class="archive-record__heading">Record</h2>
          </div>

          <dl class="archive-record__grid">
            <div class="archive-record__row">
              <dt>Title</dt>
              <dd>${safeTitle}</dd>
            </div>

            <div class="archive-record__row">
              <dt>Artist</dt>
              <dd>${safeArtist}</dd>
            </div>

            <div class="archive-record__row">
              <dt>Medium</dt>
              <dd>${safeMedium}</dd>
            </div>

            <div class="archive-record__row">
              <dt>Size</dt>
              <dd>${safeSize}</dd>
            </div>

            ${
              safeFrame
                ? `<div class="archive-record__row">
              <dt>Frame</dt>
              <dd>${safeFrame}</dd>
            </div>`
                : ""
            }

            <div class="archive-record__row">
              <dt>Archive Date</dt>
              <dd>${safeArchiveDate}</dd>
            </div>

            <div class="archive-record__row archive-record__row--url">
              <dt>Archive URL</dt>
              <dd><a href="${safeArchiveUrl}" target="_blank" rel="noopener noreferrer">${safeArchiveUrl}</a></dd>
            </div>
          </dl>
        </div>
      </section>

      <footer class="archive-footer">
        <button class="archive-download" type="button" onclick="window.print()">Download PDF</button>

        <div class="archive-signature-wrap">
          <img class="archive-signature" src="/assets/signature.png" alt="GLAMOPH signature" />
        </div>
      </footer>

    </section>
  </main>
</body>
</html>`;
}

function buildCollectorEmailHtml(record) {
  const title = escapeHtml(record.title || "Untitled");
  const ownerUrl = escapeHtml(record.ownerArchiveUrl || "");
  const publicId = escapeHtml(record.archiveId || "");
  const edition = escapeHtml(record.edition || "");
  const imageUrl = escapeHtml(resolveRecordImageUrl(record.image || ""));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>

<body style="margin:0;padding:0;background:#f4f1ea;color:#141414;font-family:Montserrat,Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:auto;padding:40px 20px;">

  <!-- ブランド -->
  <tr>
    <td style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#6b665f;padding-bottom:18px;">
      GLAMOPH
    </td>
  </tr>

  <!-- タイトル -->
  <tr>
    <td style="padding-bottom:18px;">
      <div style="font-family:'Cormorant Garamond', serif;font-size:46px;line-height:1.0;font-weight:300;">
        <span translate="no">${title}</span>
      </div>
    </td>
  </tr>

  <!-- 宣言（ここが核） -->
  <tr>
    <td style="padding-bottom:28px;">
      <div style="font-size:13px;line-height:1.9;color:#6b665f;max-width:34ch;">
        This work has been recorded.<br/>
        Your collector access is now ready.
      </div>
    </td>
  </tr>

  <!-- 画像 -->
  ${
    imageUrl
      ? `<tr>
          <td style="padding-bottom:28px;">
            <img src="${imageUrl}" style="width:100%;display:block;" />
          </td>
        </tr>`
      : ""
  }

  <!-- CTA -->
  <tr>
    <td style="padding-bottom:18px;">
      <a href="${ownerUrl}" target="_blank"
        style="display:inline-block;padding:14px 22px;background:#141414;color:#f4f1ea;text-decoration:none;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;">
        Enter Collector View
      </a>
    </td>
  </tr>

  <!-- メタ -->
  <tr>
    <td style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#6b665f;padding-bottom:28px;">
      Artwork ID: ${publicId}<br/>
      Edition: ${edition}
    </td>
  </tr>

  <!-- フッター -->
  <tr>
    <td style="border-top:1px solid rgba(20,20,20,0.1);padding-top:20px;font-size:11px;color:#6b665f;">
      This link provides access to your private collector record.
    </td>
  </tr>

</table>

</body>
</html>`;
}

function buildCollectorEmailText(record) {
  const title = record.title || "Untitled";
  const ownerUrl = record.ownerArchiveUrl || "";
  const publicId = record.archiveId || "";
  const edition = record.edition || "";

  return [
    "GLAMOPH Collector Access",
    "",
    title,
    "",
    "Your collector record is now available.",
    "Enter your private access view to claim this edition.",
    "",
    `Artwork ID: ${publicId}`,
    `Edition: ${edition}`,
    "",
    ownerUrl,
    "",
    "This access link is intended for the collector’s private record view.",
  ].join("\n");
}

async function sendCollectorAccessEmail(record) {
  const to = String(record.customerEmail || "").trim();

  if (!to) {
    console.log("Skip collector email: no customer email");
    return;
  }

  if (!resend || !resendFromEmail) {
    console.log("Skip collector email: RESEND not configured");
    return;
  }

  const subject = `GLAMOPH — ${record.title || record.archiveId || "Artwork Record"}`;

  await resend.emails.send({
    from: resendFromEmail,
    to,
    subject,
    html: buildCollectorEmailHtml(record),
    text: buildCollectorEmailText(record),
  });

  console.log("Collector email sent:", to, record.archiveId);
}

async function getNextEdition({ artworkCode, sizeCode }) {
  const file = await readJsonFile("records-source.json", {});
  const source = normalizeMap(file.data);
  const key = `${artworkCode}-${sizeCode}`;

  if (!source[key]) {
    source[key] = {
      lastEditionNumber: 0,
      editionTotal: resolveEditionTotal(sizeCode),
    };
  }

  source[key].lastEditionNumber += 1;

  await writeJsonFile(
    "records-source.json",
    source,
    `Update edition counter: ${key}`
  );

  return {
    editionNumber: source[key].lastEditionNumber,
    editionTotal: source[key].editionTotal || resolveEditionTotal(sizeCode),
  };
}

async function getIssuedIndex() {
  const file = await readJsonFile("issued-index.json", {});
  return normalizeMap(file.data);
}

async function updateIssuedIndex(lineItemId, payload) {
  const current = await getIssuedIndex();
  current[String(lineItemId)] = payload;

  await writeJsonFile(
    "issued-index.json",
    current,
    `Update issued index: ${lineItemId}`
  );
}

async function updateRecordsLog(publicId, internalId) {
  const file = await readJsonFile("records-log.json", {});
  const current = normalizeMap(file.data);

  current[publicId] = internalId;

  await writeJsonFile(
    "records-log.json",
    current,
    `Update records-log: ${publicId}`
  );
}

async function createRecordFile(internalId, record) {
  await writeJsonFile(
    `records/${internalId}/data.json`,
    record,
    `Create record: ${internalId}`
  );
}

function normalizeOrderId(value) {
  return String(value || "").trim();
}

async function findIssuedByOrderId(orderId) {
  const file = await readJsonFile("issued-index.json", {});
  const issuedIndex = normalizeMap(file.data);

  return Object.values(issuedIndex).filter((item) => {
    return normalizeOrderId(item?.orderId) === normalizeOrderId(orderId);
  });
}

async function processOrderWebhook(order) {
  const orderId = order?.id;
  const orderName = order?.name || "";
  const createdAt = order?.created_at || new Date().toISOString();
  const customerEmail = String(order?.email || order?.contact_email || "").trim();
  const customerFirstName = String(order?.customer?.first_name || "").trim();
  const customerLastName = String(order?.customer?.last_name || "").trim();
  const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];

  console.log("ORDER ID:", orderId);
  console.log("ORDER NAME:", orderName);
  console.log("LINE ITEMS:", lineItems.length);

  if (!orderId || lineItems.length === 0) {
    console.log("No order id or line items. Skip.");
    return;
  }

  const issuedIndex = await getIssuedIndex();

  for (const item of lineItems) {
    const lineItemId = item?.id;
    if (!lineItemId) continue;

    if (issuedIndex[String(lineItemId)]) {
      console.log("Already issued. Skip:", lineItemId);
      continue;
    }

    const sku = String(item?.sku || "").trim().toUpperCase();
    const productId = item?.product_id;
    const title = String(item?.title || "").trim();
    const variantTitle = String(item?.variant_title || "").trim().toUpperCase();

    const nonArtworkKeywords = [
      "LENS-PROTECT",
      "CASE-LEATHER",
      "PROTECT",
      "2YR",
      "PREM",
    ];

    const looksLikeNonArtwork =
      nonArtworkKeywords.some((kw) => sku.includes(kw)) ||
      nonArtworkKeywords.some((kw) => variantTitle.includes(kw)) ||
      /protect|case|leather/i.test(title);

    if (looksLikeNonArtwork) {
      console.log("Skip non-artwork line item:", { title, sku, variantTitle });
      continue;
    }

    let artworkCode = "";
    let sizeCode = "";
    let frameCode = "";

    if (sku) {
      const parsed = parseSku(sku);

      if (!parsed.valid) {
        console.log("Invalid SKU format:", sku);
        continue;
      }

      artworkCode = parsed.artworkCode;
      sizeCode = parsed.sizeCode;
      frameCode = parsed.frameCode;
    }

    if (!artworkCode) {
      console.log("No artworkCode resolved from SKU/title");
    }

    if (!sizeCode) {
      if (/\bS\b/.test(variantTitle)) sizeCode = "S";
      else if (/\bM\b/.test(variantTitle)) sizeCode = "M";
      else if (/\bL\b/.test(variantTitle)) sizeCode = "L";
    }

    if (!artworkCode || !sizeCode) {
      console.log("Skip line item due to unresolved artwork/size:", {
        title,
        sku,
        variantTitle,
      });
      continue;
    }

    if (!productId) {
      console.log("Skip line item due to missing product_id:", lineItemId);
      continue;
    }

    const { editionNumber, editionTotal } = await getNextEdition({
      artworkCode,
      sizeCode,
    });

    const publicId = buildPublicId({
      artworkCode,
      sizeCode,
      editionNumber,
    });

    const internalId = buildInternalId(publicId);

    console.log("ISSUE START:", publicId);

    let imageResult = {
      filePath: `images/${artworkCode}.jpg`,
    };

    try {
      const syncedImage = await syncProductFeaturedImageToGitHub(productId);
      if (syncedImage?.filePath) imageResult = syncedImage;
    } catch (error) {
      console.error("Image sync failed:", error);
    }

    const ownerToken = crypto.randomBytes(6).toString("hex");
    const publicArchiveUrl = `${VERIFY_PUBLIC_BASE_URL}/${publicId}`;
    const ownerArchiveUrl = `${VERIFY_PUBLIC_BASE_URL}/${publicId}?t=${ownerToken}`;

    const record = {
      verified: "Artwork Verified",
      title,
      archiveId: publicId,
      internalId,
      edition: `${pad2(editionNumber)} / ${editionTotal}`,
      editionNumber,
      editionTotal,
      artist: "GLAMOPH",
      medium: "Archival pigment print on fine art paper",
      size: resolveSizeLabel(sizeCode),
      frame: frameCode === "BLK" ? "Black" : "White",
      archiveDate: formatArchiveDate(createdAt),
      archiveUrl: publicArchiveUrl,
      ownerArchiveUrl,
      image: `/${imageResult.filePath}`,
      artworkCode,
      sizeCode,
      shopifyOrderId: orderId,
      orderName,
      lineItemId,
      sku,
      createdAt,
      updatedAt: new Date().toISOString(),
      ownerToken,
      customerEmail,
      customerFirstName,
      customerLastName,
    };

    await createRecordFile(internalId, record);
    await updateRecordsLog(publicId, internalId);

    await updateIssuedIndex(lineItemId, {
      publicId,
      internalId,
      orderId,
      orderName,
      sku,
      createdAt,
    });

    await sendCollectorAccessEmail(record);

    console.log("Issued:", publicId, "=>", internalId);
  }
}

app.post(
  "/webhooks/orders-paid",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    console.log("WEBHOOK RECEIVED:", req.path);

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    const hmac = req.get("X-Shopify-Hmac-Sha256") || "";

    console.log("HMAC EXISTS:", Boolean(hmac));

    let verified = false;

    try {
      verified = verifyShopifyWebhook(rawBody, hmac);
    } catch (error) {
      console.error("Webhook verification setup error:", error);
      return res.status(500).send("Webhook secret error");
    }

    if (!verified) {
      return res.status(401).send("Invalid webhook signature");
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch (error) {
      return res.status(400).send("Invalid JSON");
    }

    res.status(200).send("ok");

    setImmediate(async () => {
      try {
        await processOrderWebhook(payload);
      } catch (error) {
        console.error("orders-paid processing error:", error);
      }
    });
  }
);

app.post(
  "/webhooks/orders-create",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    console.log("WEBHOOK RECEIVED:", req.path);

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    const hmac = req.get("X-Shopify-Hmac-Sha256") || "";

    console.log("HMAC EXISTS:", Boolean(hmac));

    let verified = false;

    try {
      verified = verifyShopifyWebhook(rawBody, hmac);
    } catch (error) {
      console.error("Webhook verification setup error:", error);
      return res.status(500).send("Webhook secret error");
    }

    if (!verified) {
      return res.status(401).send("Invalid webhook signature");
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch (error) {
      return res.status(400).send("Invalid JSON");
    }

    res.status(200).send("ok");

    setImmediate(async () => {
      try {
        await processOrderWebhook(payload);
      } catch (error) {
        console.error("orders-create processing error:", error);
      }
    });
  }
);

app.post(
  "/admin/reissue-order",
  express.json({ limit: "1mb" }),
  async (req, res) => {
    try {
      const adminToken = String(req.get("x-admin-token") || req.query.token || "").trim();
      const expectedToken = String(process.env.ADMIN_REISSUE_TOKEN || "").trim();

      if (!expectedToken || adminToken !== expectedToken) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }

      const rawOrderId = req.body?.orderId;
      const orderId = normalizeOrderId(rawOrderId);

      if (!orderId) {
        return res.status(400).json({ ok: false, error: "Missing orderId" });
      }

      const existing = await findIssuedByOrderId(orderId);
      if (existing.length > 0) {
        return res.status(200).json({
          ok: true,
          skipped: true,
          reason: "Already issued",
          orderId,
          records: existing,
        });
      }

      const shop = String(process.env.SHOPIFY_STORE_DOMAIN || "").trim();
      const adminTokenValue = String(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim();

      if (!shop || !adminTokenValue) {
        return res.status(500).json({
          ok: false,
          error: "Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN",
        });
      }

      const endpoint = `https://${shop}/admin/api/2025-01/orders/${orderId}.json?status=any`;

      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": adminTokenValue,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const text = await response.text();
        return res.status(response.status).json({
          ok: false,
          error: "Failed to fetch order from Shopify",
          detail: text,
        });
      }

      const data = await response.json();
      const order = data?.order;

      if (!order?.id) {
        return res.status(404).json({
          ok: false,
          error: "Order not found",
        });
      }

      await processOrderWebhook(order);

      const created = await findIssuedByOrderId(order.id);

      return res.status(200).json({
        ok: true,
        orderId: String(order.id),
        createdCount: created.length,
        records: created,
      });
    } catch (error) {
      console.error("ADMIN REISSUE ERROR:", error);
      return res.status(500).json({
        ok: false,
        error: error?.message || "Internal Server Error",
      });
    }
  }
);

app.get("/:recordId", async (req, res) => {
  const publicId = String(req.params.recordId || "").trim().toUpperCase();

  if (!publicId) {
    return res.status(400).send("Invalid Record ID");
  }

  try {
    const logFile = await readJsonFile("records-log.json", {});
    const recordsLog = normalizeMap(logFile?.data);
    const internalId = String(recordsLog[publicId] || "").trim();

    if (!internalId) {
      return res.status(404).send("Record not found");
    }

    const file = await readJsonFile(`records/${internalId}/data.json`, null);

    if (!file?.data) {
      return res.status(404).send("Record not found");
    }

    const record = file.data;
    const token = String(req.query.t || "").trim();
    const isOwner = Boolean(token && record.ownerToken && token === record.ownerToken);
    const html = buildPageHtml(record, publicId, { isOwner });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (error) {
    console.error("VERIFY PAGE ERROR:", error);
    return res.status(500).send("Internal Server Error");
  }
});

app.listen(PORT, () => {
  console.log(`GLAMOPH verify listening on :${PORT}`);
});
