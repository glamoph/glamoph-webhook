const path = require("path");
const { getProductForArchive } = require("./shopify-admin");
const { putFileBase64 } = require("./github-contents");

function makeTitleCode(title) {
  const clean = String(title || "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim();

  const words = clean.split(/\s+/).filter(Boolean);
  if (!words.length) return "ARTWORK";

  const initials = words.map((w) => w[0]).join("").toUpperCase();
  if (initials.length >= 3) return initials.slice(0, 8);

  return clean.replace(/\s+/g, "").slice(0, 8).toUpperCase() || "ARTWORK";
}

function resolveArchiveFileName({ artworkCode, title, imageUrl }) {
  const ext = (() => {
    try {
      const pathname = new URL(imageUrl).pathname;
      const raw = path.extname(pathname).toLowerCase();
      if ([".jpg", ".jpeg", ".png", ".webp"].includes(raw)) {
        return raw === ".jpeg" ? ".jpg" : raw;
      }
    } catch (_) {}
    return ".jpg";
  })();

  const base =
    String(artworkCode || "").trim().toUpperCase() ||
    makeTitleCode(title);

  return `${base}${ext}`;
}

async function downloadBinary(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Image download failed: ${res.status} ${url}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function syncProductFeaturedImageToGitHub(productId, artworkCodeOverride = "") {
  const product = await getProductForArchive(productId);

  const fileName = resolveArchiveFileName({
    artworkCode: artworkCodeOverride || product.artworkCode,
    title: product.title,
    imageUrl: product.imageUrl,
  });

  const filePath = `images/${fileName}`;
  const buffer = await downloadBinary(product.imageUrl);

  await putFileBase64({
    path: filePath,
    base64Content: buffer.toString("base64"),
    message: `Sync product image: ${fileName}`,
  });

  return {
    productId: product.id,
    title: product.title,
    artworkCode: product.artworkCode,
    imageUrl: product.imageUrl,
    fileName,
    filePath,
  };
}

module.exports = {
  syncProductFeaturedImageToGitHub,
  resolveArchiveFileName,
};
