console.log("🚀 GLAMOPH VERIFY (REDIRECT + WEBHOOK)");

const express = require("express");
const crypto = require("crypto");

const {
  readJsonFile,
  writeJsonFile
} = require("./lib/github-contents");

const {
  syncRecordToGithub
} = require("./lib/record-sync");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "2mb" }));

// ===============================
// HEALTH
// ===============================
app.get("/", (req, res) => {
  res.send("GLAMOPH Verify System");
});

// ===============================
// REDIRECT (既存そのまま)
// ===============================
app.get("/:archiveId", (req, res) => {
  const archiveId = String(req.params.archiveId || "").trim().toUpperCase();

  if (!archiveId) {
    return res.status(400).send("Invalid Archive ID");
  }

  const redirectUrl = `https://glamoph.github.io/glamoph-archive/?id=${archiveId}`;

  console.log("Redirecting to:", redirectUrl);

  return res.redirect(redirectUrl);
});

// ===============================
// UTILS
// ===============================
function randomSuffix(length = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(length);
  let out = "";

  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }

  return out;
}

// ===============================
// WEBHOOK
// ===============================
app.post("/webhooks/orders-create", async (req, res) => {
  try {
    const order = req.body;

    console.log("📦 ORDER RECEIVED:", order?.name);

    const lineItems = order?.line_items || [];

    const results = [];

    for (const item of lineItems) {

      const lineItemId = item.id;

      // ===== SKUからパース（ここ重要）=====
      const sku = item.sku || ""; // 例: GLAMOPH-ABWIAST-L-BLK
      const parts = sku.split("-");

      const artworkCode = parts[1];
      const size = parts[2];

      if (!artworkCode || !size) {
        continue;
      }

      // ===== Edition採番 =====
      const source = await readJsonFile("records-source.json", {});
      const key = `${artworkCode}-${size}`;

      if (!source[key]) {
        source[key] = {
          lastEditionNumber: 0,
          editionTotal: 50
        };
      }

      source[key].lastEditionNumber += 1;

      await writeJsonFile(
        "records-source.json",
        source,
        `Update edition ${key}`
      );

      const editionNumber = source[key].lastEditionNumber;
      const editionTotal = source[key].editionTotal;

      const publicId = `GLA-${artworkCode}-${size}-${String(editionNumber).padStart(3, "0")}`;

      const internalId = `${publicId}-${randomSuffix(8)}`;

      // ===== record作成 =====
      const record = {
        artworkId: publicId,
        internalId,
        title: item.title,
        edition: `${String(editionNumber).padStart(2, "0")} / ${editionTotal}`,
        size,
        image: item.image?.src || "",
        createdAt: new Date().toISOString()
      };

      await syncRecordToGithub(internalId, record);

      // ===== records-log 更新 =====
      const log = await readJsonFile("records-log.json", {});
      log[publicId] = internalId;

      await writeJsonFile(
        "records-log.json",
        log,
        `Update records-log ${publicId}`
      );

      results.push({
        publicId,
        internalId,
        url: `https://verify.glamoph.com/${publicId}`
      });
    }

    return res.json({
      ok: true,
      results
    });

  } catch (err) {
    console.error("❌ WEBHOOK ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`GLAMOPH verify listening on :${PORT}`);
});
