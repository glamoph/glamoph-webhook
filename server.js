const express = require("express");

const app = express();

const PORT = process.env.PORT || 3000;

const ARCHIVE_OWNER = process.env.ARCHIVE_OWNER || "glamoph";
const ARCHIVE_REPO = process.env.ARCHIVE_REPO || "glamoph-archive";
const ARCHIVE_BRANCH = process.env.ARCHIVE_BRANCH || "main";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatEdition(editionNumber) {
  const n = Number(editionNumber || 0);
  return String(n).padStart(3, "0");
}

function archiveRawUrl(path) {
  const clean = String(path || "").replace(/^\/+/, "");
  return `https://raw.githubusercontent.com/${ARCHIVE_OWNER}/${ARCHIVE_REPO}/${ARCHIVE_BRANCH}/${clean}`;
}

function recordJsonUrl(archiveId) {
  return archiveRawUrl(`records/${encodeURIComponent(archiveId)}/data.json`);
}

function imageUrlFromRecord(record) {
  return archiveRawUrl(String(record.image || "").replace(/^\/+/, ""));
}

function buildPageHtml(record, archiveId) {
  const title = record.title || "Untitled";
  const artworkCode = record.artworkCode || "";

  // 数値（内部用）
  const rawEditionNumber = record.editionNumber || 1;

  // 表示用（001）
  const editionNumber = String(rawEditionNumber).padStart(3, "0");

  const handle = record.handle || "";
  const productId = record.productId || "";

  const createdAt = record.createdAt
    ? new Date(record.createdAt).toLocaleString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  const imageUrl = imageUrlFromRecord(record);

  // ★ ここが最重要（追加）
  const displayArchiveId =
    record.archiveId || `GLA-${artworkCode}-${editionNumber}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)} — GLAMOPH Verify</title>
  <style>
    :root {
      --bg: #f4f2ee;
      --panel: rgba(255,255,255,0.62);
      --line: rgba(0,0,0,0.08);
      --text: #131313;
      --muted: rgba(19,19,19,0.56);
      --accent: #0f0f0f;
      --radius: 28px;
      --shadow: 0 18px 60px rgba(0,0,0,0.08);
    }

    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      background:
        radial-gradient(circle at top left, rgba(166,197,255,0.25), transparent 32%),
        radial-gradient(circle at bottom right, rgba(255,186,186,0.18), transparent 30%),
        var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    .page {
      width: 100%;
      max-width: 1320px;
      margin: 0 auto;
      padding: 34px 22px 48px;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 28px;
    }

    .brand {
      font-family: "Times New Roman", Georgia, serif;
      font-size: 44px;
      letter-spacing: -0.04em;
      line-height: 1;
      text-decoration: none;
      color: var(--text);
    }

    .verify-badge {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.42);
      padding: 10px 16px;
      border-radius: 999px;
      font-size: 12px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
      backdrop-filter: blur(12px);
    }

    .verify-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #1b1b1b;
    }

    .shell {
      border: 1px solid var(--line);
      background: var(--panel);
      box-shadow: var(--shadow);
      border-radius: var(--radius);
      backdrop-filter: blur(18px);
      overflow: hidden;
    }

    .hero {
      display: grid;
      grid-template-columns: minmax(320px, 1.05fr) minmax(280px, 0.95fr);
      gap: 0;
      min-height: 760px;
    }

    .art {
      position: relative;
      border-right: 1px solid var(--line);
      background: rgba(255,255,255,0.22);
      min-height: 620px;
    }

    .art img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .info {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 38px 34px 34px;
      background: rgba(255,255,255,0.28);
    }

    .meta-top {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .eyebrow {
      font-size: 11px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .title {
      margin: 0;
      font-family: "Times New Roman", Georgia, serif;
      font-size: clamp(42px, 5vw, 76px);
      line-height: 0.94;
      letter-spacing: -0.045em;
      font-weight: 400;
      max-width: 10ch;
    }

    .id-block {
      display: grid;
      gap: 14px;
      padding-top: 4px;
    }

    .id-row {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .id-label {
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .id-value {
      font-size: 20px;
      line-height: 1.2;
      color: var(--text);
      word-break: break-word;
    }

    .details {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px 20px;
      padding-top: 26px;
      margin-top: 26px;
      border-top: 1px solid var(--line);
    }

    .detail {
      display: flex;
      flex-direction: column;
      gap: 5px;
      min-width: 0;
    }

    .detail-label {
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .detail-value {
      font-size: 16px;
      line-height: 1.35;
      color: var(--text);
      word-break: break-word;
    }

    .foot {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding-top: 28px;
      margin-top: 30px;
      border-top: 1px solid var(--line);
    }

    .statement {
      font-size: 18px;
      line-height: 1.5;
      max-width: 34ch;
    }

    .statement strong {
      font-weight: 500;
    }

    .sub {
      font-size: 12px;
      line-height: 1.7;
      color: var(--muted);
      max-width: 52ch;
    }

    .page-footer {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      margin-top: 18px;
      font-size: 11px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .error-wrap {
      max-width: 900px;
      margin: 0 auto;
      padding: 34px 22px 48px;
    }

    .error-card {
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.72);
      border-radius: 28px;
      box-shadow: var(--shadow);
      padding: 34px;
    }

    .error-title {
      font-family: "Times New Roman", Georgia, serif;
      font-size: 48px;
      line-height: 0.98;
      margin: 0 0 16px;
    }

    .error-text {
      font-size: 18px;
      line-height: 1.6;
      color: var(--muted);
      max-width: 40ch;
    }

    @media (max-width: 980px) {
      .hero {
        grid-template-columns: 1fr;
      }

      .art {
        border-right: 0;
        border-bottom: 1px solid var(--line);
        min-height: auto;
      }

      .title {
        max-width: none;
      }

      .details {
        grid-template-columns: 1fr;
      }

      .page-footer {
        flex-direction: column;
      }
    }

    @media (max-width: 640px) {
      .page {
        padding: 18px 14px 28px;
      }

      .topbar {
        margin-bottom: 16px;
      }

      .brand {
        font-size: 34px;
      }

      .info {
        padding: 24px 20px 22px;
      }

      .title {
        font-size: clamp(34px, 10vw, 52px);
      }

      .id-value {
        font-size: 16px;
      }

      .statement {
        font-size: 16px;
      }
    }

    @media print {
      body {
        background: #fff;
      }

      .page {
        max-width: none;
        padding: 0;
      }

      .shell {
        box-shadow: none;
        border-radius: 0;
        border: 0;
      }

      .topbar,
      .page-footer {
        display: none;
      }

      .hero {
        min-height: auto;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="topbar">
      <a class="brand" href="/">GLAMOPH</a>
      <div class="verify-badge">
        <span class="verify-dot"></span>
        Artwork Verified
      </div>
    </div>

    <div class="shell">
      <section class="hero">
        <div class="art">
          <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" />
        </div>

        <div class="info">
          <div class="meta-top">
            <div class="eyebrow">GLAMOPH Certificate Record</div>

            <h1 class="title">${escapeHtml(title)}</h1>

            <div class="id-block">
              <div class="id-row">
                <div class="id-label">Archive ID</div>
                <div class="id-value">${escapeHtml(archiveId)}</div>
              </div>

              <div class="id-row">
                <div class="id-label">Edition</div>
                <div class="id-value">${escapeHtml(editionNumber)}</div>
              </div>
            </div>

            <div class="details">
              <div class="detail">
                <div class="detail-label">Artwork Code</div>
                <div class="detail-value">${escapeHtml(artworkCode)}</div>
              </div>

              <div class="detail">
                <div class="detail-label">Issued</div>
                <div class="detail-value">${escapeHtml(createdAt)}</div>
              </div>

              <div class="detail">
                <div class="detail-label">Handle</div>
                <div class="detail-value">${escapeHtml(handle)}</div>
              </div>

              <div class="detail">
                <div class="detail-label">Product Reference</div>
                <div class="detail-value">${escapeHtml(productId)}</div>
              </div>
            </div>
          </div>

          <div class="foot">
            <div class="statement">
              This page certifies that this archive record was issued by <strong>GLAMOPH</strong> and linked to a specific artwork entry in the official archive.
            </div>

            <div class="sub">
              The archive record, image reference, issue time, and identifier are stored as a published record structure. This page functions as the public-facing authenticity layer for the artwork.
            </div>
          </div>
        </div>
      </section>
    </div>

    <div class="page-footer">
      <div>GLAMOPH Verification System</div>
      <div>${escapeHtml(archiveId)}</div>
    </div>
  </div>
</body>
</html>`;
}

function buildErrorHtml(title, message) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)} — GLAMOPH Verify</title>
  <style>
    body {
      margin: 0;
      background: #f4f2ee;
      color: #131313;
      font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
    }
    .wrap {
      max-width: 900px;
      margin: 0 auto;
      padding: 34px 22px 48px;
    }
    .brand {
      display: inline-block;
      margin-bottom: 18px;
      color: #131313;
      text-decoration: none;
      font-family: "Times New Roman", Georgia, serif;
      font-size: 44px;
      letter-spacing: -0.04em;
    }
    .card {
      background: rgba(255,255,255,0.74);
      border: 1px solid rgba(0,0,0,0.08);
      border-radius: 28px;
      padding: 34px;
      box-shadow: 0 18px 60px rgba(0,0,0,0.08);
    }
    h1 {
      margin: 0 0 14px;
      font-family: "Times New Roman", Georgia, serif;
      font-size: 48px;
      line-height: 0.98;
      letter-spacing: -0.04em;
      font-weight: 400;
    }
    p {
      margin: 0;
      font-size: 18px;
      line-height: 1.6;
      color: rgba(19,19,19,0.62);
      max-width: 38ch;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <a href="/" class="brand">GLAMOPH</a>
    <div class="card">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </div>
  </div>
</body>
</html>`;
}

app.get("/", (req, res) => {
  res.status(200).send(
    buildErrorHtml(
      "GLAMOPH Verify",
      "Enter a valid archive ID in the URL to view a certificate record."
    )
  );
});

app.get("/:archiveId", async (req, res) => {
  try {
    const archiveId = String(req.params.archiveId || "").trim().toUpperCase();

    if (!archiveId) {
      return res.status(400).send(
        buildErrorHtml(
          "Invalid Record",
          "The requested archive ID is missing."
        )
      );
    }

    const response = await fetch(recordJsonUrl(archiveId), {
      headers: {
        "User-Agent": "glamoph-verify",
        Accept: "application/json",
      },
    });

    if (response.status === 404) {
      return res.status(404).send(
        buildErrorHtml(
          "Record Not Found",
          "This certificate record does not exist in the public archive."
        )
      );
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Archive fetch failed: ${response.status} ${text}`);
    }

    const record = await response.json();

    return res.status(200).send(buildPageHtml(record, archiveId));
  } catch (error) {
    console.error(error);
    return res.status(500).send(
      buildErrorHtml(
        "Verification Unavailable",
        "The certificate page could not be loaded right now."
      )
    );
  }
});

app.listen(PORT, () => {
  console.log(`GLAMOPH verify listening on :${PORT}`);
});
