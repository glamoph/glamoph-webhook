const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

app.get("/", (_req, res) => {
  res.send("GLAMOPH webhook running");
});

function parseLineItem(item) {
  const sku = String(item?.sku || "").trim().toUpperCase();

  // SKU例:
  // GLAMOPH-ABIGWO-S-WHT
  // GLAMOPH-ABIGWO-L-BLK
  const match = sku.match(/^GLAMOPH-([A-Z0-9]+)-([SML])-(WHT|BLK)$/);
  if (!match) return null;

  const artworkCode = match[1];
  const sizeCode = match[2];
  const frameCode = match[3];

  const sizeMap = {
    S: { sizeLabel: "16 × 20 in (S)", editionTotal: 50 },
    M: { sizeLabel: "20 × 25 in (M)", editionTotal: 30 },
    L: { sizeLabel: "24 × 30 in (L)", editionTotal: 10 },
  };

  const frameMap = {
    BLK: "Black",
    WHT: "White",
  };

  const sizeData = sizeMap[sizeCode];
  if (!sizeData) return null;

  return {
    artworkCode,
    sizeCode,
    title: String(item?.title || artworkCode).trim(),
    sizeLabel: sizeData.sizeLabel,
    editionTotal: sizeData.editionTotal,
    frame: frameMap[frameCode] || "Black",
    imageFile: `${artworkCode}.jpg`,
  };
}

function createRecord(recordId, parsed) {
  const dir = path.join(__dirname, "records");

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = path.join(dir, `${recordId}.json`);

  const data = {
    verified: "Artwork Verified",
    title: parsed.title,
    artworkId: recordId,
    edition: `Edition ${recordId.split("-").pop()} / ${parsed.editionTotal}`,
    artist: "GLAMOPH",
    medium: "Archival pigment print on fine art paper",
    size: parsed.sizeLabel,
    frame: parsed.frame,
    archiveDate: new Date().toISOString().split("T")[0],
    image: parsed.imageFile,
  };

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");

  console.log("Record created:", recordId);
}

app.post("/webhooks/shopify/orders-paid", (req, res) => {
  const order = req.body;

  console.log("Webhook received:", {
    topic: req.headers["x-shopify-topic"],
    orderName: order?.name,
    financial_status: order?.financial_status,
  });

  if (!order) {
    return res.status(400).send("No order body");
  }

  if (order.financial_status !== "paid") {
    console.log("Not paid → skip");
    return res.status(200).send("Skip (not paid)");
  }

  console.log("Processing paid order:", order.name);

  for (const item of order.line_items || []) {
    const parsed = parseLineItem(item);

    if (!parsed) {
      console.log("Skip line item (unmatched SKU):", item?.sku);
      continue;
    }

    console.log("Parsed item:", parsed);

    const recordId = `GLA-${parsed.artworkCode}-${parsed.sizeCode}-001`;

    createRecord(recordId, parsed);
  }

  res.status(200).send("OK");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${PORT}`);
});
