const express = require("express");
const { verifyShopifyWebhook } = require("./lib/webhook-verify");
const { syncProductFeaturedImageToGitHub } = require("./lib/image-sync");

const app = express();

app.post(
  "/webhooks/orders-create",
  express.raw({ type: "*/*", limit: "2mb" }),
  async (req, res) => {
    try {
      const rawBody = req.body.toString("utf8");
      const hmac = req.get("X-Shopify-Hmac-Sha256");

      if (!verifyShopifyWebhook(rawBody, hmac)) {
        return res.status(401).send("Invalid webhook signature");
      }

      const payload = JSON.parse(rawBody);
      const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];

      const synced = [];
      const seen = new Set();

      for (const item of lineItems) {
        const productId = item.product_id;
        if (!productId) continue;
        if (seen.has(productId)) continue;

        seen.add(productId);

        try {
          const result = await syncProductFeaturedImageToGitHub(productId);
          synced.push(result);
        } catch (err) {
          console.error(`Failed to sync product ${productId}:`, err);
        }
      }

      return res.status(200).json({
        ok: true,
        orderId: payload.id || null,
        syncedCount: synced.length,
        synced,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({
        ok: false,
        error: err.message,
      });
    }
  }
);

app.use(express.json({ limit: "2mb" }));

app.post("/tools/sync-product-image", async (req, res) => {
  try {
    const { productId } = req.body || {};
    const result = await syncProductFeaturedImageToGitHub(productId);

    return res.status(200).json({
      ok: true,
      result,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Listening on :${port}`);
});
