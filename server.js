const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 8080;

// =========================
// Edition自動カウント
// =========================
function getNextEditionNumber(artworkCode, sizeCode) {
  const dir = path.join(__dirname, "records");

  if (!fs.existsSync(dir)) return "001";

  const files = fs.readdirSync(dir);

  const prefix = `GLA-${artworkCode}-${sizeCode}-`;

  const numbers = files
    .filter((f) => f.startsWith(prefix))
    .map((f) => parseInt(f.replace(".json", "").split("-").pop(), 10))
    .filter((n) => !isNaN(n));

  if (numbers.length === 0) return "001";

  const next = Math.max(...numbers) + 1;

  return String(next).padStart(3, "0");
}

// =========================
// SKUパース
// =========================
function parseLineItem(lineItem) {
  const sku = lineItem.sku || "";

  // 例: GLAMOPH-ABIGWO-S-WHT
  const parts = sku.split("-");

  if (parts.length < 4) return null;

  return {
    artworkCode: parts[1], // ABIGWO
    sizeCode: parts[2], // S
    frame: parts[3] === "BLK" ? "Black" : "White",
    imageFile: `${parts[1]}.jpg`,
  };
}

// =========================
// ルート
// =========================
app.get("/", (req, res) => {
  res.send("GLAMOPH webhook running");
});

// =========================
// Webhook（注文作成）
// =========================
app.post("/webhooks/shopify/orders-paid", express.json(), (req, res) => {
  console.log("Webhook received:", {
    topic: req.headers["x-shopify-topic"],
    orderName: req.body.name,
    financial_status: req.body.financial_status,
  });

  const order = req.body;

  // 支払い済みだけ処理
  if (order.financial_status !== "paid") {
    return res.status(200).send("Skipped (not paid)");
  }

  console.log(`Processing paid order: ${order.name}`);

  const recordsDir = path.join(__dirname, "records");

  if (!fs.existsSync(recordsDir)) {
    fs.mkdirSync(recordsDir);
  }

  order.line_items.forEach((item) => {
    const parsed = parseLineItem(item);

    if (!parsed) {
      console.log("Skip line item (parse failed)");
      return;
    }

    console.log(parsed);

    // ★ Edition自動生成
    const editionNumber = getNextEditionNumber(
      parsed.artworkCode,
      parsed.sizeCode
    );

    const recordId = `GLA-${parsed.artworkCode}-${parsed.sizeCode}-${editionNumber}`;

    const record = {
      id: recordId,
      title: item.title,
      artworkCode: parsed.artworkCode,
      size: parsed.sizeCode,
      frame: parsed.frame,
      image: parsed.imageFile,
      createdAt: new Date().toISOString(),
    };

    const filePath = path.join(recordsDir, `${recordId}.json`);

    fs.writeFileSync(filePath, JSON.stringify(record, null, 2));

    console.log(`Create record → ${recordId}`);
  });

  res.status(200).send("OK");
});

// =========================
// 起動
// =========================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${PORT}`);
});
