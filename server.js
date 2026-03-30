console.log("🔥 WEBHOOK HIT");

const express = require("express");
const crypto = require("crypto");

const { verifyShopifyWebhook } = require("./lib/webhook-verify");
const { readJsonFile, writeJsonFile } = require("./lib/github-contents");
const { syncProductFeaturedImageToGitHub } = require("./lib/image-sync");

const app = express();
const PORT = process.env.PORT || 3000;

const VERIFY_PUBLIC_BASE_URL = "https://glamoph-verify-production.up.railway.app";

app.get("/", (req, res) => {
  res.send("GLAMOPH Verify System");
});

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
  // 想定: GLAMOPH-ABWIAST-L-BLK
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
    const title = item?.title || "";
    const { artworkCode, sizeCode } = parseSku(sku);

    if (!artworkCode || !sizeCode) {
      console.log("Skip line item due to invalid SKU:", sku);
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

    const imageResult = await syncProductFeaturedImageToGitHub(productId);

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

// 本番: orders/paid を使う
app.post(
  "/webhooks/orders-paid",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    const hmac = req.get("X-Shopify-Hmac-Sha256") || "";

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

    // 先に 200 を返す
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

// テスト用: orders/create も残しておく
app.post(
  "/webhooks/orders-create",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    const hmac = req.get("X-Shopify-Hmac-Sha256") || "";

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

// Redirect は最後
app.get("/:archiveId", (req, res) => {
  const archiveId = String(req.params.archiveId || "").trim().toUpperCase();

  if (!archiveId) {
    return res.status(400).send("Invalid Archive ID");
  }

  const redirectUrl = `https://glamoph.github.io/glamoph-archive/?id=${archiveId}`;

  console.log("Redirecting to:", redirectUrl);

  return res.redirect(redirectUrl);
});

app.listen(PORT, () => {
  console.log(`GLAMOPH verify listening on :${PORT}`);
});
