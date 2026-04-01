console.log("🚀 GLAMOPH VERIFY (DIRECT RENDER + WEBHOOK)");

const express = require("express");
const crypto = require("crypto");
const path = require("path");

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

function parseSku(sku) {
  const raw = String(sku || "").trim().toUpperCase();
  const parts = raw.split("-").filter(Boolean);

  if (parts.length < 3) {
    return {
      artworkCode: "",
      sizeCode: "",
    };
  }

  return {
    artworkCode: parts[1] || "",
    sizeCode: parts[2] || "",
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

function buildPageHtml(record, recordId) {
  const imageUrl = resolveRecordImageUrl(record.image || "");
  const safeTitle = escapeHtml(record.title || "Untitled");
  const safeVerified = escapeHtml(record.verified || "Artwork Verified");
  const safeArtworkId = escapeHtml(record.archiveId || recordId);
  const safeEdition = escapeHtml(
    record.edition ||
      (record.editionNumber && record.editionTotal
        ? `${String(record.editionNumber).padStart(2, "0")} / ${record.editionTotal}`
        : "—")
  );
  const safeArtist = escapeHtml(record.artist || "GLAMOPH");
  const safeMedium = escapeHtml(record.medium || "");
  const safeSize = escapeHtml(record.size || "");
  const safeFrame = escapeHtml(record.frame || "");
  const safeArchiveDate = escapeHtml(record.archiveDate || "");
  const safeArchiveUrl = escapeHtml(record.archiveUrl || `${VERIFY_PUBLIC_BASE_URL}/${recordId}`);

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
        <p class="archive-status">${safeVerified}</p>
      </header>

      <section class="archive-hero">
        <div class="archive-hero-copy">
          <h1 class="archive-title">${safeTitle}</h1>

          <div class="archive-meta-line">
            <div class="archive-meta-block">
              <span class="archive-meta-label">Artwork ID</span>
              <span class="archive-meta-value">${safeArtworkId}</span>
            </div>

            <div class="archive-meta-divider">/</div>

            <div class="archive-meta-block">
              <span class="archive-meta-label">Edition</span>
              <span class="archive-meta-value">${safeEdition}</span>
            </div>
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

async function processOrderWebhook(order) {
  const orderId = order?.id;
  const orderName = order?.name || "";
  const createdAt = order?.created_at || new Date().toISOString();
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
      console.log("Skip non-artwork line item:", {
        title,
        sku,
        variantTitle,
      });
      continue;
    }

    let artworkCode = "";
    let sizeCode = "";

    if (sku) {
      const parsed = parseSku(sku);
      artworkCode = parsed.artworkCode || "";
      sizeCode = parsed.sizeCode || "";
    }

    if (!artworkCode) {
      const artworkMap = {
        "A BIG WORLD IN A SMALL TANK": "ABWIAST",
      };

      artworkCode = artworkMap[title.toUpperCase()] || "";
    }

    if (!sizeCode) {
      if (/\bS\b/.test(variantTitle)) sizeCode = "S";
      else if (/\bM\b/.test(variantTitle)) sizeCode = "M";
      else if (/\bL\b/.test(variantTitle)) sizeCode = "L";
    }

    console.log("LINE ITEM ID:", lineItemId);
    console.log("TITLE:", title);
    console.log("SKU:", sku);
    console.log("VARIANT TITLE:", variantTitle);
    console.log("PRODUCT ID:", productId);
    console.log("PARSED:", { artworkCode, sizeCode });

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
      console.log("BEFORE IMAGE SYNC:", publicId);
      const syncedImage = await syncProductFeaturedImageToGitHub(productId);

      if (syncedImage?.filePath) {
        imageResult = syncedImage;
      }

      console.log("IMAGE SYNC RESULT:", imageResult);
    } catch (error) {
      console.error("Image sync failed:", error);
      console.log("FALLBACK IMAGE PATH:", imageResult.filePath);
    }

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
      archiveDate: formatArchiveDate(createdAt),
      archiveUrl: `${VERIFY_PUBLIC_BASE_URL}/${publicId}`,
      image: `/${imageResult.filePath}`,
      artworkCode,
      sizeCode,
      shopifyOrderId: orderId,
      orderName,
      lineItemId,
      sku,
      createdAt,
      updatedAt: new Date().toISOString(),
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
    const html = buildPageHtml(record, publicId);

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
