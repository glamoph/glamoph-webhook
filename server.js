const express = require("express");
const crypto = require("crypto");
const {
  getNextEditionNumberFromGitHub,
  commitJsonFile,
  appendRecordLog,
} = require("./src/github");

const app = express();
const PORT = process.env.PORT || 8080;

app.get("/", (_req, res) => {
  res.send("GLAMOPH webhook running");
});

app.post(
  "/webhooks/shopify/orders-paid",
  express.raw({ type: "*/*", limit: "2mb" }),
  async (req, res) => {
    try {
      const secret = process.env.SHOPIFY_WEBHOOK_SECRET || "";
      const shopifyHmac = req.get("X-Shopify-Hmac-SHA256") || "";

      if (!secret) {
        console.error("Missing SHOPIFY_WEBHOOK_SECRET");
        return res.status(500).send("Missing webhook secret");
      }

      const digest = crypto
        .createHmac("sha256", secret)
        .update(req.body)
        .digest("base64");

      const valid =
        shopifyHmac &&
        crypto.timingSafeEqual(
          Buffer.from(digest, "utf8"),
          Buffer.from(shopifyHmac, "utf8")
        );

      if (!valid) {
        console.error("Invalid webhook signature");
        return res.status(401).send("Invalid signature");
      }

      const order = JSON.parse(req.body.toString("utf8"));

      console.log("Webhook received:", {
        topic: req.get("X-Shopify-Topic"),
        orderName: order?.name,
        financial_status: order?.financial_status,
      });

      res.status(200).send("OK");

      setImmediate(async () => {
        try {
          await handleOrder(order);
        } catch (error) {
          console.error("handleOrder failed:", error);
        }
      });
    } catch (error) {
      console.error("Webhook error:", error);
      return res.status(500).send("Server error");
    }
  }
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${PORT}`);
});

async function handleOrder(order) {
  if (!order) {
    console.log("No order body");
    return;
  }

  if (order.financial_status !== "paid") {
    console.log("Not paid → skip");
    return;
  }

  const orderName = order.name || "";
  const shopifyOrderId = order.id || "";
  const createdAt = order.created_at || new Date().toISOString();
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];

  console.log(`Processing paid order: ${orderName}`);

  for (const item of lineItems) {
    const parsed = parseLineItem(item);
    if (!parsed) {
      console.log("Skip line item (unmatched SKU):", item?.sku || item?.title);
      continue;
    }

    const {
      artworkCode,
      sizeCode,
      title,
      sizeLabel,
      editionTotal,
      frame,
      imageFile,
    } = parsed;

    const editionNo = await getNextEditionNumberFromGitHub({
      artworkCode,
      sizeCode,
    });

    const artworkId = `GLA-${artworkCode}-${sizeCode}-${String(editionNo).padStart(3, "0")}`;
    const archiveUrl = `https://verify.glamoph.com/${artworkId}`;

    const record = {
      verified: "Artwork Verified",
      title,
      artworkId,
      edition: `Edition ${String(editionNo).padStart(2, "0")} / ${editionTotal}`,
      artist: "GLAMOPH",
      medium: "Archival pigment print on fine art paper",
      size: sizeLabel,
      frame,
      archiveDate: formatArchiveDate(createdAt),
      archiveUrl,
      image: `/images/${imageFile}`,
      meta: {
        shopifyOrderId,
        orderName,
        lineItemId: item.id || "",
        sku: item.sku || "",
        artworkCode,
        sizeCode,
        editionNo,
      },
    };

    await commitJsonFile({
      path: `records/${artworkId}.json`,
      content: record,
      message: `Add certificate record: ${artworkId}`,
    });

    await appendRecordLog({
      artworkId,
      shopifyOrderId,
      orderName,
      lineItemId: item.id || "",
      sku: item.sku || "",
      createdAt,
    });

    console.log(`Created record: ${artworkId}`);
  }
}

function parseLineItem(item) {
  const sku = String(item?.sku || "").trim().toUpperCase();

  // SKU例: AMFW-S / AMFW-M / AMFW-L
  const match = sku.match(/^([A-Z0-9]+)-([SML])$/);
  if (!match) return null;

  const artworkCode = match[1];
  const sizeCode = match[2];

  const sizeMap = {
    S: { sizeLabel: "16 × 20 in (S)", editionTotal: 50 },
    M: { sizeLabel: "20 × 25 in (M)", editionTotal: 30 },
    L: { sizeLabel: "24 × 30 in (L)", editionTotal: 10 },
  };

  const sizeData = sizeMap[sizeCode];
  const title = String(item?.title || artworkCode).trim();
  const frame = normalizeFrame(item);

  return {
    artworkCode,
    sizeCode,
    title,
    sizeLabel: sizeData.sizeLabel,
    editionTotal: sizeData.editionTotal,
    frame,
    imageFile: `${artworkCode}.jpg`,
  };
}

function normalizeFrame(item) {
  const props = Array.isArray(item?.properties) ? item.properties : [];
  const found = props.find((p) =>
    String(p?.name || "").toLowerCase().includes("frame")
  );

  const value = String(found?.value || "Black").trim();
  return value || "Black";
}

function formatArchiveDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
