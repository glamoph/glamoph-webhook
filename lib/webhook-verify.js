const crypto = require("crypto");

function verifyShopifyWebhook(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) throw new Error("Missing SHOPIFY_WEBHOOK_SECRET");
  if (!hmacHeader) return false;

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(digest),
      Buffer.from(String(hmacHeader))
    );
  } catch (_) {
    return false;
  }
}

module.exports = {
  verifyShopifyWebhook,
};
