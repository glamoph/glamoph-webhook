const { getProductForArchive } = require("./shopify-admin");
const { putFileBase64 } = require("./github-contents");
const { syncProductFeaturedImageToGitHub, resolveArchiveFileName } = require("./image-sync");

function makeArtworkCodeFromTitle(title) {
  const clean = String(title || "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim();

  const words = clean.split(/\s+/).filter(Boolean);
  if (!words.length) return "ARTWORK";

  const initials = words.map((w) => w[0]).join("").toUpperCase();
  if (initials.length >= 3) return initials.slice(0, 8);

  return clean.replace(/\s+/g, "").slice(0, 8).toUpperCase() || "ARTWORK";
}

function padEdition(num) {
  return String(num).padStart(3, "0");
}

function makeArchiveId({ artworkCode, editionNumber }) {
  return `GLA-${artworkCode}-${padEdition(editionNumber)}`;
}

function buildRecordJson({
  archiveId,
  title,
  imagePath,
  artworkCode,
  productId,
  handle,
  editionNumber,
}) {
  const now = new Date().toISOString();

  return {
    archiveId,
    title,
    artworkCode,
    productId,
    handle,
    editionNumber,
    image: `/${imagePath}`,
    createdAt: now,
    updatedAt: now,
    verified: true,
  };
}

async function putJsonFile({ path, data, message }) {
  const json = Buffer.from(JSON.stringify(data, null, 2) + "\n").toString("base64");

  await putFileBase64({
    path,
    base64Content: json,
    message,
  });
}

async function syncRecordToGitHub(productId, editionNumber = 1) {
  const product = await getProductForArchive(productId);

  const imageResult = await syncProductFeaturedImageToGitHub(productId);

  const artworkCode =
    String(product.artworkCode || "").trim().toUpperCase() ||
    makeArtworkCodeFromTitle(product.title);

  const archiveId = makeArchiveId({
    artworkCode,
    editionNumber,
  });

  const record = buildRecordJson({
    archiveId,
    title: product.title,
    imagePath: imageResult.filePath,
    artworkCode,
    productId: product.id,
    handle: product.handle,
    editionNumber,
  });

  const recordPath = `records/${archiveId}/data.json`;

  await putJsonFile({
    path: recordPath,
    data: record,
    message: `Create record: ${archiveId}`,
  });

  return {
    archiveId,
    recordPath,
    imagePath: imageResult.filePath,
    record,
  };
}

module.exports = {
  syncRecordToGitHub,
};
