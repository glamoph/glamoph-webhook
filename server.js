console.log("🚀 GLAMOPH VERIFY (DIRECT RENDER + WEBHOOK)");

const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { Resend } = require("resend");
const puppeteer = require("puppeteer-core");
const { execSync } = require("child_process");

const { verifyShopifyWebhook } = require("./lib/webhook-verify");
const { readJsonFile, writeJsonFile, putFileBase64 } = require("./lib/github-contents");
const { readPrivateJsonFile, writePrivateJsonFile } = require("./lib/private-github-contents");
const { syncProductFeaturedImageToGitHub } = require("./lib/image-sync");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const VERIFY_PUBLIC_BASE_URL =
  (process.env.VERIFY_PUBLIC_BASE_URL || "https://verify.glamoph.com").replace(/\/+$/, "");

const ARCHIVE_ASSET_BASE_URL =
  (process.env.ARCHIVE_ASSET_BASE_URL || "https://glamoph.github.io/glamoph-archive").replace(/\/+$/, "");

const resendApiKey = String(process.env.RESEND_API_KEY || "").trim();
const resendFromEmail = String(process.env.RESEND_FROM_EMAIL || "").trim();
const resend = resendApiKey ? new Resend(resendApiKey) : null;

app.get("/", (req, res) => {
  res.send("GLAMOPH Verify System");
});

// Legacy test endpoint.
// Not used for the current Shopify certificate issuance flow.
// Manual issuance should use /admin/reissue-order.
app.post('/api/publish', express.json(), async (req, res) => {
  try {
    const {
      artworkCode,
      sku,
      size,
      title,
      image,
      artist,
      frame,
      medium,
      editionNumber
    } = req.body;

    if (!artworkCode || !size || !title) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields'
      });
    }

    const editionMap = {
      S: 50,
      M: 30,
      L: 10
    };

    const total = editionMap[size] || 50;
    const edition = editionNumber || 1;

    const artworkId = `GLA-${artworkCode}-${size}-${String(edition).padStart(3, '0')}`;

    const record = {
      verified: "Artwork Verified",
      title,
      artworkId,
      edition: `Edition ${String(edition).padStart(2, '0')} / ${total}`,
      artist: artist || "GLAMOPH",
      medium: medium || "Giclée print on museum-quality fine art paper",
      size: size,
      frame: frame || "Black",
      archiveUrl: `${VERIFY_PUBLIC_BASE_URL}/${artworkId}`,
      image: image || `/images/${artworkCode}.jpg`
    };

    return res.json({
      ok: true,
      record,
      github: {
        filePath: `records/${artworkId}/data.json`,
        commitSha: "mock"
      }
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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

function parseSku(rawSku = "") {
  const sku = String(rawSku).trim().toUpperCase();

  // GLAMOPH-XXXXXX-S-BLK
  const match = sku.match(/^GLAMOPH-([A-Z0-9]+)-([SML])-(BLK|WHT)$/);

  if (!match) {
    return {
      valid: false,
      sku,
      artworkCode: "",
      sizeCode: "",
      frameCode: "",
    };
  }

  return {
    valid: true,
    sku,
    artworkCode: match[1],
    sizeCode: match[2],
    frameCode: match[3],
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

function getCollectorName(record) {
  const firstName = String(record.customerFirstName || "").trim();
  const lastName = String(record.customerLastName || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();

  if (fullName) return fullName;

  return "";
}

function buildPublicId({ artworkCode, sizeCode, editionNumber }) {
  return `GLA-${artworkCode}-${sizeCode}-${pad3(editionNumber)}`;
}

function buildInternalId(publicId) {
  return `${publicId}-${randomSuffix(8)}`;
}
function buildCollectorUrl(internalId, ownerToken) {
  const id = encodeURIComponent(String(internalId || "").trim());
  const token = encodeURIComponent(String(ownerToken || "").trim());
  return `${VERIFY_PUBLIC_BASE_URL}/collector/${id}?t=${token}`;
}

function buildCollectorPdfUrl(internalId, ownerToken) {
  const id = encodeURIComponent(String(internalId || "").trim());
  const token = encodeURIComponent(String(ownerToken || "").trim());
  return `${VERIFY_PUBLIC_BASE_URL}/collector/${id}/certificate.pdf?t=${token}`;
}


function resolveRecordImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (/^https?:\/\//i.test(raw)) return raw;

  if (raw.startsWith("/")) {
    return `${ARCHIVE_ASSET_BASE_URL}${raw}`;
  }

  return `${ARCHIVE_ASSET_BASE_URL}/${raw}`;
}

function buildPageHtml(record, recordId, options = {}) {
  const { isOwner } = options;

  const imageUrl = resolveRecordImageUrl(record.image || "");
  const safeTitle = escapeHtml(record.title || "Untitled");
  const safeVerified = "ARCHIVE RECORD";
  const safeArtworkId = escapeHtml(record.archiveId || recordId);
  const safeEdition = escapeHtml(record.edition || "");
  const safeArtist = escapeHtml(record.artist || "GLAMOPH");
  const safeMedium = escapeHtml(record.medium || "");
  const safeSize = escapeHtml(record.size || "");
  const safeFrame = escapeHtml(record.frame || "");
  const safeArchiveDate = escapeHtml(record.archiveDate || "");
  const safeArchiveUrl = escapeHtml(
  record.permanentArchiveUrl ||
  `${VERIFY_PUBLIC_BASE_URL}/${recordId}`
);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GLAMOPH — ${safeTitle}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500&family=Montserrat:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/archive.css" />
</head>
<body>
  <main class="archive-page">
    <section class="archive-shell">

      <header class="archive-header">
  <div class="archive-status-line">
    <span class="archive-status">${safeVerified}</span>
  </div>
</header>

      <section class="archive-hero">
        <div class="archive-hero__content">
          <h1 class="archive-title">${safeTitle}</h1>

          <div class="archive-meta-line">
            <span class="archive-meta-id">${safeArtworkId}</span>
            <span class="archive-meta-edition">${safeEdition}</span>
          </div>
        </div>

        <figure class="archive-artwork">
          ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${safeTitle}" />` : ""}
        </figure>
      </section>

      <section class="archive-record">
        <div class="archive-record__inner">
         
          <dl class="archive-record__grid">
            <div class="archive-record__row">
              <dt>Title</dt>
              <dd>${safeTitle}</dd>
            </div>

            <div class="archive-record__row">
              <dt>Artist</dt>
              <dd>${safeArtist}</dd>
            </div>

            <div class="archive-record__row">
              <dt>Medium</dt>
              <dd>${safeMedium}</dd>
            </div>

            <div class="archive-record__row">
              <dt>Size</dt>
              <dd>${safeSize}</dd>
            </div>

            ${
              safeFrame
                ? `<div class="archive-record__row">
                     <dt>Frame</dt>
                     <dd>${safeFrame}</dd>
                   </div>`
                : ""
            }

            <div class="archive-record__row">
              <dt>Archive Date</dt>
              <dd>${safeArchiveDate}</dd>
            </div>

            <div class="archive-record__row archive-record__row--url">
              <dt>Archive URL</dt>
              <dd><a href="${safeArchiveUrl}" target="_blank" rel="noopener noreferrer">${safeArchiveUrl}</a></dd>
            </div>
          </dl>
        </div>
      </section>

      <footer class="archive-footer">
        <button class="archive-download" type="button" onclick="window.print()">Download PDF</button>

        ${
          isOwner
            ? `<div class="archive-signature-wrap">
                 <img class="archive-signature" src="/assets/signature.png" alt="GLAMOPH signature" />
               </div>`
            : ""
        }
      </footer>

    </section>
  </main>
</body>
</html>`;
}

function buildStaticPageHtml(record) {
  // Public Archive pages must never contain owner tokens, customer data,
  // or collector-only signature access. Collector access is served dynamically
  // through /collector/:internalId?t=... after token validation.
  return buildPageHtml(record, record.archiveId, { isOwner: false })
    .replace('href="/archive.css"', `href="${ARCHIVE_ASSET_BASE_URL}/public/archive.css"`)
    .replace('src="/assets/signature.png"', `src="${ARCHIVE_ASSET_BASE_URL}/public/assets/signature.png"`);
}

function buildPdfHtml(record, options = {}) {
  const pdfUrl = record.pdfUrl || `${ARCHIVE_ASSET_BASE_URL}/records/${record.internalId}/certificate.pdf`;
  const isOwner = options.isOwner !== false;

  return buildPageHtml(record, record.archiveId, { isOwner })
    .replace('href="/archive.css"', `href="${ARCHIVE_ASSET_BASE_URL}/public/archive.css"`)
    .replace('src="/assets/signature.png"', `src="${ARCHIVE_ASSET_BASE_URL}/public/assets/signature.png"`)
    .replace(
      '<button class="archive-download" type="button" onclick="window.print()">Download PDF</button>',
      `<a class="archive-download" href="${pdfUrl}" target="_blank" rel="noopener noreferrer">Download PDF</a>`
    )
    .replace(
      "</head>",
      `<style>
        @page { size: A4; margin: 0; }
        .archive-download { display: none !important; }
      </style></head>`
    );
}

function resolveChromiumPath() {
  const commands = [
    "which chromium",
    "which chromium-browser",
    "which google-chrome",
    "which google-chrome-stable",
    "find /nix/store -name chromium -type f | head -n 1",
  ];

  for (const cmd of commands) {
    try {
      const result = execSync(cmd).toString().trim();

      if (result) {
        return result;
      }
    } catch (_) {}
  }

  throw new Error("Chromium executable not found");
}

async function imageToDataUri(url) {
  const rawUrl = url.replace(
    "https://archive.glamoph.com/",
    "https://raw.githubusercontent.com/glamoph/glamoph-archive/main/"
  );

  console.log("PDF IMAGE RAW FETCH:", rawUrl);

  const res = await fetch(rawUrl, {
    headers: {
      "User-Agent": "GLAMOPH-PDF-Renderer",
      "Accept": "image/*",
    },
  });

  if (!res.ok) {
    throw new Error(`PDF raw image fetch failed: ${res.status} ${rawUrl}`);
  }

  const contentType = res.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await res.arrayBuffer());

  console.log("PDF IMAGE RAW OK:", rawUrl, buffer.length);

  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

async function inlineImagesForPdf(html) {
  const imgRegex = /<img\b[^>]*\bsrc=(["'])(.*?)\1[^>]*>/gi;
  const matches = [...html.matchAll(imgRegex)];

  let result = html;

  for (const match of matches) {
    const quote = match[1];
    const originalSrc = match[2];

    const absoluteUrl = /^https?:\/\//i.test(originalSrc)
      ? originalSrc
      : `${ARCHIVE_ASSET_BASE_URL}${originalSrc.startsWith("/") ? originalSrc : `/${originalSrc}`}`;

    const dataUri = await imageToDataUri(absoluteUrl);

    const originalAttr = `src=${quote}${originalSrc}${quote}`;
    result = result.replaceAll(originalAttr, `src="${dataUri}"`);
  }

  return result;
}

async function retryAsync(fn, options = {}) {
  const retries = Number(options.retries || 3);
  const delayMs = Number(options.delayMs || 2000);
  const label = options.label || "operation";

  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.error(`${label} failed ${attempt}/${retries}:`, error?.message || error);

      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

async function generateAndUploadCertificatePdf(internalId, record, messagePrefix = "Create") {
  if (!internalId) {
    throw new Error("Missing internalId");
  }

  const pdfHtml = buildPdfHtml(sanitizePublicRecord(record), { isOwner: false });

  const pdfBase64 = await retryAsync(
    () => generatePdfBase64(pdfHtml),
    {
      retries: 3,
      delayMs: 2500,
      label: `PDF generation for ${internalId}`,
    }
  );

  await putFileBase64({
    path: `records/${internalId}/certificate.pdf`,
    base64Content: pdfBase64,
    message: `${messagePrefix} record PDF: ${internalId}`,
  });

  return {
    ok: true,
    internalId,
    pdfUrl: `${ARCHIVE_ASSET_BASE_URL}/records/${internalId}/certificate.pdf`,
  };
}

async function resolveInternalIdForAdmin(inputId) {
  const raw = String(inputId || "").trim();

  if (!raw) {
    throw new Error("Missing recordId");
  }

  const normalized = raw.toUpperCase();

  // internalId 直指定の場合: GLA-XXXXXX-M-001-XXXXXXXX
  if (/^GLA-[A-Z0-9]+-[SML]-\d{3}-[A-Z0-9]{8}$/.test(normalized)) {
    return normalized;
  }

  // publicId 指定の場合: GLA-XXXXXX-M-001
  if (/^GLA-[A-Z0-9]+-[SML]-\d{3}$/.test(normalized)) {
    const logFile = await readJsonFile("records-log.json", {});
    const recordsLog = normalizeMap(logFile?.data);
    const internalId = String(recordsLog[normalized] || "").trim();

    if (!internalId) {
      throw new Error(`Record not found in records-log: ${normalized}`);
    }

    return internalId;
  }

  throw new Error("Invalid recordId format. Use publicId or internalId.");
}

async function generatePdfBase64(html) {
  const inlinedHtml = await inlineImagesForPdf(html);

  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const page = await browser.newPage();

    await page.setViewport({
      width: 1400,
      height: 2000,
      deviceScaleFactor: 2,
    });

    await page.setBypassCSP(true);

    await page.setContent(inlinedHtml, {
      waitUntil: "load",
      timeout: 120000,
    });


    await new Promise((resolve) => setTimeout(resolve, 2000));

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
    });

    return Buffer.from(pdfBuffer).toString("base64");
  } finally {
    await browser.close();
  }
}

function resolveEmailLocale(record) {
  const candidates = [
    record?.locale,
    record?.customerLocale,
    record?.shippingCountryCode === "JP" ? "ja" : "",
    record?.billingCountryCode === "JP" ? "ja" : "",
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());

  for (const value of candidates) {
    if (value.startsWith("ja")) return "ja";
  }

  return "en";
}

// ==========================
// SUBJECT
// ==========================
function buildCollectorEmailSubject(record) {
  const locale = resolveEmailLocale(record);

  if (locale === "ja") {
    return `[GLAMOPH] 証明書が発行されました`;
  }

  return `Your GLAMOPH Certificate is Ready`;
}


// ==========================
// HTML
// ==========================
function buildCollectorEmailHtml(record) {
  const locale = resolveEmailLocale(record);
  const isJa = locale === "ja";

const certificateUrl = escapeHtml(
  record.ownerArchiveUrl ||
  record.archiveUrl ||
  `${VERIFY_PUBLIC_BASE_URL}/${record.archiveId || ""}`
);

const pdfUrl = escapeHtml(
  record.pdfUrl ||
  `${ARCHIVE_ASSET_BASE_URL}/records/${record.internalId}/certificate.pdf`
);
const publicId = escapeHtml(record.archiveId || "");
const edition = escapeHtml(record.edition || "");
const imageUrl = escapeHtml(resolveRecordImageUrl(record.image || ""));

  // ★ ロゴURL（ここ重要）
  const logoUrl = `${ARCHIVE_ASSET_BASE_URL}/public/assets/email/logo.png`;

  if (isJa) {
    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="google" content="notranslate" />
</head>
<body style="margin:0;padding:0;background:#ffffff;color:#000000;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:auto;padding:40px 20px;">

    <!-- LOGO -->
    <tr>
      <td align="center" style="padding-bottom:48px;">
  <img src="${logoUrl}" width="120" style="display:block;border:0;margin:auto;" />
</td>
    </tr>

    <!-- IMAGE -->
    ${
      imageUrl
        ? `<tr>
            <td style="padding-bottom:32px;">
              <img src="${imageUrl}" style="width:100%;display:block;border:0;" />
            </td>
          </tr>`
        : ""
    }

    <!-- TEXT -->
    <tr>
      <td style="font-size:14px;line-height:1.9;padding-bottom:20px;">
        ご購入いただいた作品のアーカイブが完了しました。<br />
        以下より、コレクターレコードをご確認いただけます。
      </td>
    </tr>


    <!-- CTA BUTTON -->
    <tr>
  <td style="padding-bottom:14px;">
    <a href="${certificateUrl}" target="_blank"
      style="
        display:inline-block;
        padding:16px 24px;
        background:#ffffff;
        color:#000000;
        text-decoration:none;
        font-size:13px;
        letter-spacing:0.06em;
        min-width:220px;
        text-align:center;
        border:1px solid #dddddd;
      ">
      コレクターレコードを表示
    </a>
  </td>
</tr>



    <!-- META -->
    <tr>
      <td style="font-size:10px;color:#666666;">
        ${publicId}<br/>
        ${edition}
      </td>
    </tr>

  </table>
</body>
</html>`;
  }

  // ==========================
  // ENGLISH VERSION
  // ==========================
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
</head>
<body style="margin:0;padding:0;background:#ffffff;color:#000000;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:auto;padding:40px 20px;">

    <!-- LOGO -->
    <tr>
      <td style="padding-bottom:40px;">
        <img src="${logoUrl}" width="120" style="display:block;border:0;" />
      </td>
    </tr>

    <!-- IMAGE -->
    ${
      imageUrl
        ? `<tr>
            <td style="padding-bottom:32px;">
              <img src="${imageUrl}" style="width:100%;display:block;border:0;" />
            </td>
          </tr>`
        : ""
    }

   <!-- TEXT -->
<tr>
  <td style="font-size:14px;line-height:1.9;padding-bottom:20px;">
    This artwork has been recorded in the GLAMOPH Archive.<br />
    Your Collector Record is now available.
  </td>
</tr>

<!-- CTA TEXT -->
<tr>
  <td style="font-size:13px;padding-bottom:14px;">
    View your Collector Record below.
  </td>
</tr>

    <!-- CTA BUTTON -->
   <tr>
  <td style="padding-bottom:14px;">
    <a href="${certificateUrl}" target="_blank"
      style="
        display:inline-block;
        padding:16px 24px;
        background:#ffffff;
        color:#000000;
        text-decoration:none;
        font-size:13px;
        letter-spacing:0.06em;
        min-width:220px;
        text-align:center;
        border:1px solid #dddddd;
      ">
      VIEW CERTIFICATE
    </a>
  </td>
</tr>



    <!-- META -->
    <tr>
      <td style="font-size:10px;color:#666666;">
        ${publicId}<br/>
        ${edition}
      </td>
    </tr>

  </table>
</body>
</html>`;
}


// ==========================
// TEXT VERSION
// ==========================
function buildCollectorEmailText(record) {
  const locale = resolveEmailLocale(record);
  const isJa = locale === "ja";

  const ownerUrl = record.ownerArchiveUrl || "";
  const publicId = record.archiveId || "";
  const edition = record.edition || "";

  if (isJa) {
  return [
    "GLAMOPH",
    "",
    "作品は、GLAMOPH Archiveに記録されました。",
    "",
    "以下より、Collector Recordをご確認いただけます。",
    "",
    publicId,
    edition,
    "",
    ownerUrl,
  ].join("\n");
}

    return [
    "GLAMOPH",
    "",
    "This artwork has been recorded in the GLAMOPH Archive.",
    "",
    "You can view the Collector Record below.",
    "",
    publicId,
    edition,
    "",
    ownerUrl,
  ].join("\n");
}

async function sendCollectorAccessEmail(record) {
  const to = String(record.customerEmail || "").trim();

  if (!to) {
    console.log("Skip collector email: no customer email");
    return;
  }

  if (!resend || !resendFromEmail) {
    console.log("Skip collector email: RESEND not configured");
    return;
  }

  const subject = buildCollectorEmailSubject(record);

  await resend.emails.send({
    from: resendFromEmail,
    to,
    subject,
    html: buildCollectorEmailHtml(record),
    text: buildCollectorEmailText(record),
  });

  console.log("Collector email sent:", to, record.archiveId, `locale=${resolveEmailLocale(record)}`);
}

async function getMailQueue() {
  const file = await readPrivateJsonFile(PRIVATE_PATHS.mailQueue, {});
  return normalizeMap(file.data);
}

async function writeMailQueue(queue, message = "Update private mail queue") {
  await writePrivateJsonFile(PRIVATE_PATHS.mailQueue, queue, message);
}

async function enqueueCollectorAccessEmail(record, delayMs = 10 * 60 * 1000) {
  const internalId = String(record?.internalId || "").trim();

  if (!internalId) {
    console.log("Skip enqueue collector email: missing internalId");
    return;
  }

  const queueId = `collector:${internalId}`;
  const queue = await getMailQueue();
  const existing = queue[queueId];

  if (existing?.sentAt) {
    console.log("Collector email already sent. Skip enqueue:", queueId);
    return;
  }

  if (existing && !existing.sentAt) {
    console.log("Collector email already queued. Skip enqueue:", queueId);
    return;
  }

  const scheduledAt = new Date(Date.now() + delayMs).toISOString();

  queue[queueId] = {
    type: "collector_access",
    status: "pending",
    internalId,
    archiveId: String(record?.archiveId || ""),
    orderId: normalizeOrderId(record?.shopifyOrderId || record?.orderId || ""),
    orderName: String(record?.orderName || ""),
    lineItemId: String(record?.lineItemId || ""),
    customerEmail: String(record?.customerEmail || "").trim(),
    ownerToken: String(record?.ownerToken || "").trim(),
    scheduledAt,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };

  await writeMailQueue(queue, `Enqueue collector email: ${internalId}`);

  console.log("Collector email queued:", {
    queueId,
    internalId,
    scheduledAt,
  });
}

let mailQueueProcessing = false;

async function processMailQueue() {
  if (mailQueueProcessing) {
    console.log("Mail queue is already processing. Skip.");
    return;
  }

  mailQueueProcessing = true;

  try {
    const queue = await getMailQueue();
    const now = Date.now();
    let changed = false;

    for (const [queueId, job] of Object.entries(queue)) {
      if (!job || job.type !== "collector_access") continue;
      if (job.sentAt) continue;
      if (job.status === "sent") continue;

      const scheduledAt = Date.parse(job.scheduledAt || "");
      if (Number.isFinite(scheduledAt) && scheduledAt > now) continue;

      const nextRetryAt = Date.parse(job.nextRetryAt || "");
      if (Number.isFinite(nextRetryAt) && nextRetryAt > now) continue;

      const attempts = Number(job.attempts || 0);

      if (attempts >= 5) {
        queue[queueId] = {
          ...job,
          status: "failed",
          failedAt: job.failedAt || new Date().toISOString(),
          lastError: job.lastError || "Max attempts reached",
        };
        changed = true;
        continue;
      }

      try {
        const internalId = String(job.internalId || "").trim();

        if (!internalId) {
          throw new Error("Missing internalId in mail queue job");
        }

        const file = await readJsonFile(`records/${internalId}/data.json`, null);
        const publicRecord = file?.data;

        if (!publicRecord) {
          throw new Error(`Record data not found: ${internalId}`);
        }

        const record = {
          ...publicRecord,
          customerEmail: String(job.customerEmail || "").trim(),
          ownerToken: String(job.ownerToken || "").trim(),
        };

        record.ownerArchiveUrl = buildCollectorUrl(internalId, record.ownerToken);
        record.pdfUrl = buildCollectorPdfUrl(internalId, record.ownerToken);

        if (!record.customerEmail) {
          throw new Error(`Mail queue job has no customer email: ${internalId}`);
        }

        if (!record.ownerToken) {
          throw new Error(`Mail queue job has no owner token: ${internalId}`);
        }

        if (!resend || !resendFromEmail) {
          throw new Error("RESEND not configured");
        }

        await sendCollectorAccessEmail(record);

        const sentAt = new Date().toISOString();
        queue[queueId] = {
          ...job,
          status: "sent",
          sentAt,
          attempts: attempts + 1,
          lastAttemptAt: sentAt,
          archiveId: publicRecord.archiveId || job.archiveId || "",
          lastError: "",
          nextRetryAt: "",
        };

        if (job.lineItemId) {
          await updateReservation(job.lineItemId, {
            status: "certificate_sent",
            certificateSentAt: sentAt,
          }, "Mark certificate email sent");
        }

        changed = true;

        console.log("Collector email queue sent:", {
          queueId,
          internalId,
          archiveId: record.archiveId || "",
        });
      } catch (error) {
        const nextRetryAtValue = new Date(Date.now() + 5 * 60 * 1000).toISOString();

        queue[queueId] = {
          ...job,
          status: "pending",
          attempts: attempts + 1,
          lastAttemptAt: new Date().toISOString(),
          nextRetryAt: nextRetryAtValue,
          lastError: error?.message || String(error),
        };

        changed = true;

        console.error("Collector email queue error:", {
          queueId,
          error: error?.message || error,
          nextRetryAt: nextRetryAtValue,
        });
      }
    }

    if (changed) {
      await writeMailQueue(queue, "Process mail queue");
    }
  } finally {
    mailQueueProcessing = false;
  }
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

const PRIVATE_PATHS = {
  issuedIndex: "private/issued-index.json",
  orderContactIndex: "private/order-contact-index.json",
  reservationsIndex: "private/edition-reservations.json",
  mailQueue: "private/mail-queue.json",
};

async function getIssuedIndex() {
  const file = await readPrivateJsonFile(PRIVATE_PATHS.issuedIndex, {});
  return normalizeMap(file.data);
}

async function updateIssuedIndex(lineItemId, payload) {
  const current = await getIssuedIndex();
  current[String(lineItemId)] = payload;

  await writePrivateJsonFile(
    PRIVATE_PATHS.issuedIndex,
    current,
    `Update private issued index: ${lineItemId}`
  );
}

async function getOrderContactIndex() {
  const file = await readPrivateJsonFile(PRIVATE_PATHS.orderContactIndex, {});
  return normalizeMap(file.data);
}

async function writeOrderContactIndex(index, message = "Update private order contacts") {
  await writePrivateJsonFile(PRIVATE_PATHS.orderContactIndex, index, message);
}

async function getReservationsIndex() {
  const file = await readPrivateJsonFile(PRIVATE_PATHS.reservationsIndex, {});
  return normalizeMap(file.data);
}

async function writeReservationsIndex(index, message = "Update edition reservations") {
  await writePrivateJsonFile(PRIVATE_PATHS.reservationsIndex, index, message);
}

async function updateReservation(lineItemId, patch, message = "Update edition reservation") {
  const reservations = await getReservationsIndex();
  const key = String(lineItemId || "");
  if (!key) throw new Error("Missing lineItemId for reservation update");

  reservations[key] = {
    ...(reservations[key] || {}),
    ...patch,
    lineItemId: key,
    updatedAt: new Date().toISOString(),
  };

  await writeReservationsIndex(reservations, `${message}: ${key}`);
  return reservations[key];
}

let editionReservationLock = Promise.resolve();

async function withEditionReservationLock(fn) {
  const previous = editionReservationLock;
  let release;
  editionReservationLock = new Promise((resolve) => {
    release = resolve;
  });

  await previous;

  try {
    return await fn();
  } finally {
    release();
  }
}

function extractOrderContact(order) {
  const email = String(
    order?.email ||
    order?.contact_email ||
    order?.customer?.email ||
    order?.shipping_address?.email ||
    order?.billing_address?.email ||
    ""
  ).trim();

  const firstName = String(
    order?.customer?.first_name ||
    order?.shipping_address?.first_name ||
    order?.billing_address?.first_name ||
    ""
  ).trim();

  const lastName = String(
    order?.customer?.last_name ||
    order?.shipping_address?.last_name ||
    order?.billing_address?.last_name ||
    ""
  ).trim();

  return {
    email,
    firstName,
    lastName,
  };
}

async function saveOrderContact(order) {
  const orderId = normalizeOrderId(order?.id);
  const orderName = String(order?.name || "").trim();
  const contact = extractOrderContact(order);

  if (!orderId) {
    console.log("Skip contact save: no order id");
    return;
  }

  if (!contact.email) {
    console.log("Skip contact save: no email found", {
      orderId,
      orderName,
      email: order?.email || "",
      contact_email: order?.contact_email || "",
      customer_email: order?.customer?.email || "",
      shipping_email: order?.shipping_address?.email || "",
      billing_email: order?.billing_address?.email || "",
    });
    return;
  }

  const current = await getOrderContactIndex();

  current[orderId] = {
    orderId,
    orderName,
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    savedAt: new Date().toISOString(),
  };

  await writeOrderContactIndex(
    current,
    `Save private order contact: ${orderName || orderId}`
  );

  console.log("Order contact saved:", {
    orderId,
    orderName,
    email: contact.email,
  });
}

async function getSavedOrderContact(orderId) {
  const current = await getOrderContactIndex();
  return current[normalizeOrderId(orderId)] || null;
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

function sanitizePublicRecord(record) {
  const privateKeys = new Set([
    "ownerToken",
    "ownerArchiveUrl",
    "customerEmail",
    "customerFirstName",
    "customerLastName",
  ]);

  const out = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (privateKeys.has(key)) continue;
    out[key] = value;
  }

  out.recordVisibility = out.recordVisibility || "public";
  out.status = out.status || "fulfilled";
  return out;
}

async function createRecordFile(internalId, record) {
  const publicRecord = sanitizePublicRecord({
    ...record,
    permanentArchiveUrl: `${ARCHIVE_ASSET_BASE_URL}/records/${internalId}/`,
    archiveUrl: `${ARCHIVE_ASSET_BASE_URL}/records/${internalId}/`,
    // PDF is no longer uploaded to the public archive by default.
    // Collector PDFs are served dynamically from /collector/:internalId/certificate.pdf?t=...
    pdfUrl: "",
  });

  await writeJsonFile(
    `records/${internalId}/data.json`,
    publicRecord,
    `Create public record data: ${internalId}`
  );

  const staticHtml = buildStaticPageHtml(publicRecord);

  await putFileBase64({
    path: `records/${internalId}/index.html`,
    base64Content: Buffer.from(staticHtml, "utf8").toString("base64"),
    message: `Create public record page: ${internalId}`,
  });
}

function normalizeOrderId(value) {
  return String(value || "").trim();
}

function extractTrackingInfoFromFulfillment(fulfillment) {
  const trackingNumbers = Array.isArray(fulfillment?.tracking_numbers)
    ? fulfillment.tracking_numbers.filter(Boolean)
    : [];

  const trackingUrls = Array.isArray(fulfillment?.tracking_urls)
    ? fulfillment.tracking_urls.filter(Boolean)
    : [];

  const trackingNumber = String(
    fulfillment?.tracking_number ||
    trackingNumbers[0] ||
    ""
  ).trim();

  const trackingUrl = String(
    fulfillment?.tracking_url ||
    trackingUrls[0] ||
    ""
  ).trim();

  const trackingCompany = String(
    fulfillment?.tracking_company ||
    ""
  ).trim();

  return {
    trackingNumber,
    trackingUrl,
    trackingCompany,
    hasTracking: Boolean(trackingNumber),
  };
}

function extractTrackingInfoFromOrder(order) {
  const fulfillments = Array.isArray(order?.fulfillments)
    ? order.fulfillments
    : [];

  for (const fulfillment of fulfillments) {
    const info = extractTrackingInfoFromFulfillment(fulfillment);

    if (info.hasTracking) {
      return info;
    }
  }

  return {
    trackingNumber: "",
    trackingUrl: "",
    trackingCompany: "",
    hasTracking: false,
  };
}

function orderHasTrackingNumber(order) {
  return extractTrackingInfoFromOrder(order).hasTracking;
}

function collectOrderTestSignals(order) {
  const tags = String(order?.tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  const discountCodes = Array.isArray(order?.discount_codes)
    ? order.discount_codes.map((item) => item?.code || "").filter(Boolean)
    : [];

  const discountApplications = Array.isArray(order?.discount_applications)
    ? order.discount_applications
        .map((item) => item?.code || item?.title || item?.description || "")
        .filter(Boolean)
    : [];

  const paymentGateways = Array.isArray(order?.payment_gateway_names)
    ? order.payment_gateway_names.filter(Boolean)
    : [];

  const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];

  const lineItemTexts = lineItems.flatMap((item) => [
    item?.sku || "",
    item?.title || "",
    item?.variant_title || "",
    item?.vendor || "",
  ]);

  return {
    tags,
    discountCodes,
    discountApplications,
    paymentGateways,
    lineItemTexts,
    orderTexts: [
      order?.name || "",
      order?.note || "",
      order?.source_name || "",
    ],
  };
}

function textLooksLikeTest(value) {
  const text = String(value || "").trim().toUpperCase();

  if (!text) return false;

  return (
    /(^|[^A-Z0-9])TEST([^A-Z0-9]|$)/.test(text) ||
    /^TEST[-_]/.test(text) ||
    /[-_]TEST([-_]|$)/.test(text) ||
    text.includes("GLAMOPH_TEST") ||
    text.includes("BOGUS")
  );
}

function detectTestOrder(order) {
  const signals = collectOrderTestSignals(order);
  const reasons = [];

  for (const tag of signals.tags) {
    if (textLooksLikeTest(tag)) {
      reasons.push(`tag:${tag}`);
    }
  }

  for (const code of signals.discountCodes) {
    if (textLooksLikeTest(code)) {
      reasons.push(`discount_code:${code}`);
    }
  }

  for (const application of signals.discountApplications) {
    if (textLooksLikeTest(application)) {
      reasons.push(`discount_application:${application}`);
    }
  }

  for (const gateway of signals.paymentGateways) {
    if (textLooksLikeTest(gateway)) {
      reasons.push(`payment_gateway:${gateway}`);
    }
  }

  for (const text of signals.lineItemTexts) {
    if (textLooksLikeTest(text)) {
      reasons.push(`line_item:${text}`);
    }
  }

  for (const text of signals.orderTexts) {
    if (textLooksLikeTest(text)) {
      reasons.push(`order:${text}`);
    }
  }

  return {
    isTest: reasons.length > 0,
    reasons,
  };
}

async function findIssuedByOrderId(orderId) {
  const issuedIndex = await getIssuedIndex();

  return Object.values(issuedIndex).filter((item) => {
    return normalizeOrderId(item?.orderId) === normalizeOrderId(orderId);
  });
}


function resolveArtworkIdentityFromLineItem(item) {
  const sku = String(item?.sku || "").trim().toUpperCase();
  const title = String(item?.title || "").trim();
  const variantTitle = String(item?.variant_title || "").trim().toUpperCase();
  const productId = item?.product_id;

  if (!sku) {
    return { valid: false, reason: "Line item has no SKU", sku, title, variantTitle, productId };
  }

  const parsed = parseSku(sku);
  if (!parsed.valid) {
    return { valid: false, reason: `Invalid SKU format: ${sku}`, sku, title, variantTitle, productId };
  }

  let sizeCode = parsed.sizeCode;
  if (!sizeCode) {
    if (/\bS\b/.test(variantTitle)) sizeCode = "S";
    else if (/\bM\b/.test(variantTitle)) sizeCode = "M";
    else if (/\bL\b/.test(variantTitle)) sizeCode = "L";
  }

  if (!parsed.artworkCode || !sizeCode) {
    return { valid: false, reason: "Could not resolve artworkCode / size", sku, title, variantTitle, productId };
  }

  return {
    valid: true,
    sku,
    title,
    variantTitle,
    productId,
    artworkCode: parsed.artworkCode,
    sizeCode,
    frameCode: parsed.frameCode,
  };
}

function buildDStudioFileNames({ orderName, publicId, sizeCode, artworkCode }) {
  const cleanOrder = String(orderName || "ORDER").replace(/[^A-Z0-9]+/gi, "").toUpperCase() || "ORDER";
  const sizeLabel = sizeCode ? `${sizeCode}` : "SIZE";

  return {
    folderName: `${cleanOrder}_${publicId}`,
    printFileName: `GLAMOPH_${publicId}_${artworkCode}_${sizeLabel}_PRINT.tif`,
    certificateFileName: `GLAMOPH_${publicId}_COA_A5.pdf`,
    notesFileName: `GLAMOPH_${publicId}_ORDER_NOTES.txt`,
  };
}

async function ensureReservationForLineItem(order, item) {
  return withEditionReservationLock(async () => {
    const lineItemId = String(item?.id || "").trim();
    if (!lineItemId) throw new Error("Missing lineItemId");

    const existingReservations = await getReservationsIndex();
    if (existingReservations[lineItemId]) {
      return existingReservations[lineItemId];
    }

    const issuedIndex = await getIssuedIndex();
    if (issuedIndex[lineItemId]) {
      return {
        ...issuedIndex[lineItemId],
        status: "issued",
        lineItemId,
      };
    }

    if (!isArtworkLineItem(item)) {
      throw new Error("Selected line item is not an artwork item");
    }

    const identity = resolveArtworkIdentityFromLineItem(item);
    if (!identity.valid) {
      throw new Error(identity.reason || "Invalid artwork line item");
    }

    const orderId = normalizeOrderId(order?.id);
    const orderName = String(order?.name || "").trim();
    const directContact = extractOrderContact(order);
    const savedContact = await getSavedOrderContact(orderId);

    const customerEmail = String(directContact.email || savedContact?.email || "").trim();
    const customerFirstName = String(directContact.firstName || savedContact?.firstName || "").trim();
    const customerLastName = String(directContact.lastName || savedContact?.lastName || "").trim();

    const { editionNumber, editionTotal } = await getNextEdition({
      artworkCode: identity.artworkCode,
      sizeCode: identity.sizeCode,
    });

    const publicId = buildPublicId({
      artworkCode: identity.artworkCode,
      sizeCode: identity.sizeCode,
      editionNumber,
    });

    const internalId = buildInternalId(publicId);
    const ownerToken = crypto.randomBytes(12).toString("hex");
    const fileNames = buildDStudioFileNames({
      orderName,
      publicId,
      sizeCode: identity.sizeCode,
      artworkCode: identity.artworkCode,
    });

    const now = new Date().toISOString();
    const reservation = {
      status: "reserved",
      publicId,
      internalId,
      ownerToken,
      artworkCode: identity.artworkCode,
      sizeCode: identity.sizeCode,
      frameCode: identity.frameCode,
      editionNumber,
      editionTotal,
      edition: `${pad2(editionNumber)} / ${editionTotal}`,
      orderId,
      orderName,
      lineItemId,
      sku: identity.sku,
      title: identity.title,
      productId: identity.productId ? String(identity.productId) : "",
      customerEmail,
      customerFirstName,
      customerLastName,
      locale: String(order?.customer_locale || order?.locale || "").trim().toLowerCase(),
      shippingCountryCode: String(order?.shipping_address?.country_code || "").trim().toUpperCase(),
      billingCountryCode: String(order?.billing_address?.country_code || "").trim().toUpperCase(),
      reservedAt: now,
      updatedAt: now,
      dStudio: {
        imageSource: "Google Drive / Dropbox",
        folderName: fileNames.folderName,
        printFileName: fileNames.printFileName,
        certificateFileName: fileNames.certificateFileName,
        notesFileName: fileNames.notesFileName,
      },
    };

    existingReservations[lineItemId] = reservation;
    await writeReservationsIndex(existingReservations, `Reserve edition ${publicId} for ${orderName || orderId}`);

    console.log("Edition reserved:", {
      publicId,
      internalId,
      orderId,
      orderName,
      lineItemId,
    });

    return reservation;
  });
}

async function reserveEditionsForOrder(order) {
  const orderId = normalizeOrderId(order?.id);
  const orderName = String(order?.name || "").trim();
  const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];

  if (!orderId || !lineItems.length) {
    return { ok: true, reserved: [], skipped: true, reason: "Missing order id or line items" };
  }

  const testCheck = detectTestOrder(order);
  if (testCheck.isTest) {
    console.log("Test order detected. Skip edition reservation.", {
      orderId,
      orderName,
      reasons: testCheck.reasons,
    });
    return { ok: true, reserved: [], skipped: true, reason: "Test order", reasons: testCheck.reasons };
  }

  const results = [];

  for (const item of lineItems) {
    if (!item?.id) continue;
    if (!isArtworkLineItem(item)) continue;

    try {
      const reservation = await ensureReservationForLineItem(order, item);
      results.push(reservation);
    } catch (error) {
      console.error("Edition reservation error:", {
        orderId,
        orderName,
        lineItemId: item?.id || "",
        error: error?.message || error,
      });
    }
  }

  return { ok: true, reserved: results };
}

async function issueCertificateForLineItem(order, item) {
  const orderId = normalizeOrderId(order?.id);
  const orderName = order?.name || "";
  const createdAt = order?.created_at || new Date().toISOString();

  if (!orderId) throw new Error("Missing orderId");

  const lineItemId = String(item?.id || "").trim();
  if (!lineItemId) throw new Error("Missing lineItemId");

  const issuedIndex = await getIssuedIndex();

  if (issuedIndex[lineItemId]) {
    const existing = issuedIndex[lineItemId];
    return {
      ok: true,
      skipped: true,
      reason: "Already issued",
      record: existing,
    };
  }

  const reservation = await ensureReservationForLineItem(order, item);

  if (reservation.status === "cancelled") {
    return {
      ok: true,
      skipped: true,
      reason: "Reservation cancelled",
      record: reservation,
    };
  }

  const productId = item?.product_id || reservation.productId;
  const trackingInfo = extractTrackingInfoFromOrder(order);

  let imageResult = {
    filePath: `images/${reservation.artworkCode}.jpg`,
  };

  if (productId) {
    try {
      const syncedImage = await syncProductFeaturedImageToGitHub(productId, reservation.artworkCode);
      if (syncedImage?.filePath) imageResult = syncedImage;
    } catch (error) {
      console.error("Image sync failed:", error);
    }
  }

  const fulfilledAt = new Date().toISOString();
  const issuedAt = fulfilledAt;
  const publicArchiveUrl = `${ARCHIVE_ASSET_BASE_URL}/records/${reservation.internalId}/`;
  const ownerArchiveUrl = buildCollectorUrl(reservation.internalId, reservation.ownerToken);

  const record = {
    verified: "Archive Record",
    title: reservation.title || String(item?.title || "").trim(),
    archiveId: reservation.publicId,
    internalId: reservation.internalId,
    edition: `${pad2(reservation.editionNumber)} / ${reservation.editionTotal}`,
    editionNumber: reservation.editionNumber,
    editionTotal: reservation.editionTotal,
    artist: "GLAMOPH",
    medium: "Giclée print on museum-quality fine art paper",
    size: resolveSizeLabel(reservation.sizeCode),
    frame: reservation.frameCode === "WHT" ? "White" : "Black",
    archiveDate: formatArchiveDate(issuedAt),
    archiveUrl: publicArchiveUrl,
    image: `/${imageResult.filePath}`,
    artworkCode: reservation.artworkCode,
    sizeCode: reservation.sizeCode,
    status: "fulfilled",
    recordVisibility: "public",
    shopifyOrderId: orderId,
    orderName,
    lineItemId,
    sku: reservation.sku,
    trackingNumber: trackingInfo.trackingNumber,
    trackingUrl: trackingInfo.trackingUrl,
    trackingCompany: trackingInfo.trackingCompany,
    reservedAt: reservation.reservedAt || "",
    fulfilledAt,
    issuedAt,
    createdAt,
    updatedAt: issuedAt,
    locale: reservation.locale || String(order?.customer_locale || order?.locale || "").trim().toLowerCase(),
    shippingCountryCode: reservation.shippingCountryCode || String(order?.shipping_address?.country_code || "").trim().toUpperCase(),
    billingCountryCode: reservation.billingCountryCode || String(order?.billing_address?.country_code || "").trim().toUpperCase(),
  };

  const privateRecord = {
    ...record,
    ownerToken: reservation.ownerToken,
    ownerArchiveUrl,
    pdfUrl: buildCollectorPdfUrl(reservation.internalId, reservation.ownerToken),
    customerEmail: reservation.customerEmail || "",
    customerFirstName: reservation.customerFirstName || "",
    customerLastName: reservation.customerLastName || "",
  };

  await createRecordFile(reservation.internalId, record);
  await updateRecordsLog(reservation.publicId, reservation.internalId);

  await updateIssuedIndex(lineItemId, {
    publicId: reservation.publicId,
    internalId: reservation.internalId,
    orderId,
    orderName,
    sku: reservation.sku,
    lineItemId,
    issuedAt,
  });

  await updateReservation(lineItemId, {
    ...reservation,
    status: "fulfilled",
    fulfilledAt,
    issuedAt,
    trackingNumber: trackingInfo.trackingNumber,
    trackingUrl: trackingInfo.trackingUrl,
    trackingCompany: trackingInfo.trackingCompany,
  }, "Mark reservation fulfilled");

  return {
    ok: true,
    skipped: false,
    record: privateRecord,
  };
}


async function resendCollectorAccessByOrderId(orderId) {
  const existing = await findIssuedByOrderId(orderId);
  const reservations = await getReservationsIndex();

  if (!existing.length) {
    return {
      ok: false,
      error: "No issued record found for this orderId",
    };
  }

  const results = [];

  for (const item of existing) {
    const internalId = String(item?.internalId || "").trim();
    const lineItemId = String(item?.lineItemId || "").trim();
    if (!internalId) continue;

    const file = await readJsonFile(`records/${internalId}/data.json`, null);
    const publicRecord = file?.data;

    if (!publicRecord) {
      results.push({
        ok: false,
        internalId,
        error: "Record data not found",
      });
      continue;
    }

    const reservation = lineItemId ? reservations[lineItemId] : null;
    const ownerToken = String(reservation?.ownerToken || item?.ownerToken || "").trim();
    const customerEmail = String(reservation?.customerEmail || item?.customerEmail || "").trim();

    const record = {
      ...publicRecord,
      ownerToken,
      ownerArchiveUrl: buildCollectorUrl(internalId, ownerToken),
      pdfUrl: buildCollectorPdfUrl(internalId, ownerToken),
      customerEmail,
      customerFirstName: String(reservation?.customerFirstName || ""),
      customerLastName: String(reservation?.customerLastName || ""),
    };

    if (!record.customerEmail || !record.ownerToken) {
      results.push({
        ok: false,
        internalId,
        archiveId: publicRecord.archiveId || "",
        error: "Missing private customer email or owner token",
      });
      continue;
    }

    await sendCollectorAccessEmail(record);

    results.push({
      ok: true,
      internalId,
      archiveId: publicRecord.archiveId || "",
      title: publicRecord.title || "",
      email: record.customerEmail,
      ownerArchiveUrl: record.ownerArchiveUrl,
    });
  }

  return {
    ok: true,
    orderId,
    resentCount: results.filter((x) => x.ok).length,
    results,
  };
}


function isArtworkLineItem(item) {
  const sku = String(item?.sku || "").trim().toUpperCase();
  const title = String(item?.title || "").trim();
  const variantTitle = String(item?.variant_title || "").trim().toUpperCase();

  const nonArtworkKeywords = [
    "LENS-PROTECT",
    "CASE-LEATHER",
    "PROTECT",
    "2YR",
    "PREM",
  ];

  const looksLikeNonArtwork =
    nonArtworkKeywords.some((kw) => sku.includes(kw)) ||
    nonArtworkKeywords.some((kw) => variantTitle.includes(kw)) ||
    /protect|case|leather/i.test(title);

  return !looksLikeNonArtwork;
}

function buildAdminDraftFromLineItem(order, item) {
  const sku = String(item?.sku || "").trim().toUpperCase();
  const title = String(item?.title || "").trim();
  const variantTitle = String(item?.variant_title || "").trim().toUpperCase();

  let artworkCode = "";
  let sizeCode = "";
  let frameCode = "";

  if (sku) {
    const parsed = parseSku(sku);

    if (parsed.valid) {
      artworkCode = parsed.artworkCode;
      sizeCode = parsed.sizeCode;
      frameCode = parsed.frameCode;
    }
  }

  if (!sizeCode) {
    if (/\bS\b/.test(variantTitle)) sizeCode = "S";
    else if (/\bM\b/.test(variantTitle)) sizeCode = "M";
    else if (/\bL\b/.test(variantTitle)) sizeCode = "L";
  }

  return {
    orderId: String(order?.id || ""),
    orderName: String(order?.name || ""),
    lineItemId: String(item?.id || ""),
    productId: item?.product_id ? String(item.product_id) : "",
    sku,
    artworkCode,
    size: sizeCode,
    title,
    image: artworkCode
      ? `https://glamoph.github.io/glamoph-archive/images/${artworkCode}.jpg`
      : "",
    artist: "GLAMOPH",
    frame: frameCode === "WHT" ? "White" : "Black",
    medium: "Giclée print on museum-quality fine art paper",
    variantTitle: String(item?.variant_title || ""),
    quantity: Number(item?.quantity || 1),
    valid: Boolean(artworkCode && sizeCode && title && sku),
  };
}

function buildAdminDraftsFromOrder(order) {
  const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];

  const drafts = lineItems
    .filter(isArtworkLineItem)
    .map((item) => buildAdminDraftFromLineItem(order, item));

  if (!drafts.length) {
    throw new Error("No artwork line item found in this order");
  }

  return drafts;
}

async function fetchShopifyOrderForAdmin(orderId) {
  const shop = String(process.env.SHOPIFY_STORE_DOMAIN || "").trim();
  const adminTokenValue = String(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim();

  if (!shop || !adminTokenValue) {
    throw new Error("Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN");
  }

  const normalized = String(orderId || "").trim().replace(/^#/, "");

  if (!/^\d+$/.test(normalized)) {
    throw new Error("Please enter Shopify numeric Order ID");
  }

  const endpoint = `https://${shop}/admin/api/2025-01/orders/${normalized}.json?status=any`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "X-Shopify-Access-Token": adminTokenValue,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch order from Shopify: ${text}`);
  }

  const data = await response.json();
  const order = data?.order;

  if (!order?.id) {
    throw new Error("Order not found");
  }

  return order;
}

app.get("/admin/order-detail", async (req, res) => {
  try {
    const orderId = String(req.query.orderId || "").trim();

    if (!orderId) {
      return res.status(400).json({
        ok: false,
        error: "Missing orderId",
      });
    }

    const order = await fetchShopifyOrderForAdmin(orderId);
    const drafts = buildAdminDraftsFromOrder(order);

    return res.status(200).json({
      ok: true,
      order: {
        id: String(order.id),
        name: String(order.name || ""),
      },
      drafts,
      draft: drafts[0] || null,
    });
  } catch (error) {
    console.error("ADMIN ORDER DETAIL ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || "Internal Server Error",
    });
  }
});


app.get("/admin/reservations", async (req, res) => {
  try {
    const adminToken = String(req.get("x-admin-token") || req.query.token || "").trim();
    const expectedToken = String(process.env.ADMIN_REISSUE_TOKEN || "").trim();

    if (!expectedToken || adminToken !== expectedToken) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const reservations = await getReservationsIndex();
    const issuedIndex = await getIssuedIndex();
    const orderId = normalizeOrderId(req.query.orderId || "");

    let items = Object.values(reservations).map((item) => ({
      ...item,
      ownerToken: item.ownerToken ? "[private]" : "",
      customerEmail: item.customerEmail ? "[private]" : "",
      customerFirstName: item.customerFirstName ? "[private]" : "",
      customerLastName: item.customerLastName ? "[private]" : "",
    }));

    if (orderId) {
      items = items.filter((item) => normalizeOrderId(item.orderId) === orderId);
    }

    items.sort((a, b) => String(b.reservedAt || b.updatedAt || "").localeCompare(String(a.reservedAt || a.updatedAt || "")));

    return res.status(200).json({
      ok: true,
      count: items.length,
      reservations: items,
      issuedCount: Object.keys(issuedIndex).length,
    });
  } catch (error) {
    console.error("ADMIN RESERVATIONS ERROR:", error);
    return res.status(500).json({ ok: false, error: error?.message || "Internal Server Error" });
  }
});

app.post("/admin/reserve-order", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const adminToken = String(req.get("x-admin-token") || req.query.token || "").trim();
    const expectedToken = String(process.env.ADMIN_REISSUE_TOKEN || "").trim();

    if (!expectedToken || adminToken !== expectedToken) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const orderId = normalizeOrderId(req.body?.orderId);
    if (!orderId) {
      return res.status(400).json({ ok: false, error: "Missing orderId" });
    }

    const order = await fetchShopifyOrderForAdmin(orderId);
    await saveOrderContact(order);
    const result = await reserveEditionsForOrder(order);

    return res.status(200).json(result);
  } catch (error) {
    console.error("ADMIN RESERVE ORDER ERROR:", error);
    return res.status(500).json({ ok: false, error: error?.message || "Internal Server Error" });
  }
});

app.post("/admin/update-reservation-status", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const adminToken = String(req.get("x-admin-token") || req.query.token || "").trim();
    const expectedToken = String(process.env.ADMIN_REISSUE_TOKEN || "").trim();

    if (!expectedToken || adminToken !== expectedToken) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const lineItemId = String(req.body?.lineItemId || "").trim();
    const status = String(req.body?.status || "").trim();

    const allowed = new Set(["reserved", "print_file_ready", "sent_to_dstudio", "cancelled"]);
    if (!lineItemId || !allowed.has(status)) {
      return res.status(400).json({ ok: false, error: "Missing lineItemId or invalid status" });
    }

    const field = status === "print_file_ready" ? "printFileReadyAt" :
      status === "sent_to_dstudio" ? "sentToDStudioAt" :
      status === "cancelled" ? "cancelledAt" : "statusUpdatedAt";

    const reservation = await updateReservation(lineItemId, {
      status,
      [field]: new Date().toISOString(),
      note: String(req.body?.note || "").trim(),
    }, `Admin update reservation status ${status}`);

    return res.status(200).json({ ok: true, reservation });
  } catch (error) {
    console.error("ADMIN UPDATE RESERVATION STATUS ERROR:", error);
    return res.status(500).json({ ok: false, error: error?.message || "Internal Server Error" });
  }
});

function extractFulfilledLineItemIdsFromFulfillmentPayload(payload) {
  const ids = new Set();
  const lineItems = Array.isArray(payload?.line_items) ? payload.line_items : [];

  for (const item of lineItems) {
    const id = String(item?.id || item?.line_item_id || "").trim();
    if (id) ids.add(id);
  }

  return ids;
}

async function processOrderWebhook(order, options = {}) {
  const orderId = normalizeOrderId(order?.id);
  const orderName = order?.name || "";
  const allowedLineItemIds = options.allowedLineItemIds instanceof Set
    ? options.allowedLineItemIds
    : null;

  const testCheck = detectTestOrder(order);

  if (testCheck.isTest) {
    console.log("Test order detected. Skip certificate issue.", {
      orderId,
      orderName,
      reasons: testCheck.reasons,
    });
    return;
  }

  const trackingInfo = extractTrackingInfoFromOrder(order);

  if (!trackingInfo.hasTracking) {
    console.log("No tracking number found. Skip certificate issue.");
    return;
  }

  const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];

  console.log("ORDER ID:", orderId);
  console.log("ORDER NAME:", orderName);
  console.log("LINE ITEMS:", lineItems.length);
  console.log("TRACKING INFO:", trackingInfo);

  if (!orderId || lineItems.length === 0) {
    console.log("No order id or line items. Skip.");
    return;
  }

  for (const item of lineItems) {
    const lineItemId = String(item?.id || "").trim();
    if (!lineItemId) continue;

    if (allowedLineItemIds && allowedLineItemIds.size > 0 && !allowedLineItemIds.has(lineItemId)) {
      console.log("Skip line item not included in this fulfillment:", lineItemId);
      continue;
    }

    try {
      if (!isArtworkLineItem(item)) {
        console.log("Skip non-artwork line item:", {
          title: item?.title || "",
          sku: item?.sku || "",
          variantTitle: item?.variant_title || "",
        });
        continue;
      }

      const result = await issueCertificateForLineItem(order, item);

      if (result.skipped) {
        console.log("Certificate skipped:", {
          lineItemId,
          reason: result.reason,
          publicId: result.record?.publicId || result.record?.archiveId || "",
        });
        continue;
      }

      await enqueueCollectorAccessEmail(result.record, 10 * 60 * 1000);

      console.log("Issued:", result.record.archiveId, "=>", result.record.internalId);
      console.log("Collector email queued:", result.record.archiveId, "in 10 minutes");
    } catch (error) {
      console.error("Line item certificate issue error:", {
        orderId,
        orderName,
        lineItemId,
        error: error?.message || error,
      });
    }
  }
}


app.post(
  "/webhooks/orders-paid",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    console.log("WEBHOOK RECEIVED:", req.path);

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    const hmac = req.get("X-Shopify-Hmac-Sha256") || "";

    console.log("HMAC EXISTS:", Boolean(hmac));

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
        await saveOrderContact(payload);
        await reserveEditionsForOrder(payload);
      } catch (error) {
        console.error("orders-paid reservation/contact save error:", error);
      }
    });
  }
);

app.post(
  "/webhooks/orders-create",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    console.log("WEBHOOK RECEIVED:", req.path);

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    const hmac = req.get("X-Shopify-Hmac-Sha256") || "";

    console.log("HMAC EXISTS:", Boolean(hmac));

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
        await saveOrderContact(payload);
      } catch (error) {
        console.error("orders-create contact save error:", error);
      }
    });
  }
);

app.post(
  "/webhooks/orders-cancelled",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    console.log("WEBHOOK RECEIVED:", req.path);

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
        const orderId = normalizeOrderId(payload?.id);
        const orderName = String(payload?.name || "").trim();
        const lineItems = Array.isArray(payload?.line_items) ? payload.line_items : [];
        const reservations = await getReservationsIndex();
        let changed = false;
        const cancelledAt = new Date().toISOString();

        for (const item of lineItems) {
          const lineItemId = String(item?.id || "").trim();
          if (!lineItemId || !reservations[lineItemId]) continue;
          if (reservations[lineItemId].status === "certificate_sent") continue;
          if (reservations[lineItemId].status === "fulfilled") continue;

          reservations[lineItemId] = {
            ...reservations[lineItemId],
            status: "cancelled",
            cancelledAt,
            cancelReason: String(payload?.cancel_reason || "").trim(),
            orderId: reservations[lineItemId].orderId || orderId,
            orderName: reservations[lineItemId].orderName || orderName,
            updatedAt: cancelledAt,
          };
          changed = true;
        }

        if (changed) {
          await writeReservationsIndex(reservations, `Mark reservations cancelled: ${orderName || orderId}`);
        }
      } catch (error) {
        console.error("orders-cancelled processing error:", error);
      }
    });
  }
);

app.post(
  "/webhooks/fulfillments-create",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    console.log("WEBHOOK RECEIVED:", req.path);

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    const hmac = req.get("X-Shopify-Hmac-Sha256") || "";

    console.log("HMAC EXISTS:", Boolean(hmac));

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
        const orderId = payload?.order_id;

        if (!orderId) {
          console.log("fulfillments-create: missing order_id. Skip.");
          return;
        }

        console.log("FULFILLMENT ORDER ID:", orderId);

        const order = await fetchShopifyOrderForAdmin(orderId);

        const testCheck = detectTestOrder(order);

        if (testCheck.isTest) {
          console.log("Test order detected from fulfillment webhook. Skip certificate issue.", {
            orderId,
            orderName: order?.name || "",
            reasons: testCheck.reasons,
          });
          return;
        }

        const fulfillmentStatus = String(order?.fulfillment_status || "").trim().toLowerCase();
        const trackingInfo = extractTrackingInfoFromOrder(order);
        const fulfilledLineItemIds = extractFulfilledLineItemIdsFromFulfillmentPayload(payload);

        console.log("ORDER FULFILLMENT STATUS:", fulfillmentStatus || "(empty)");
        console.log("ORDER TRACKING INFO:", trackingInfo);
        console.log("FULFILLED LINE ITEM IDS:", Array.from(fulfilledLineItemIds));

        if (!trackingInfo.hasTracking) {
          console.log("Order has no tracking number yet. Skip certificate issue.");
          return;
        }

        if (fulfilledLineItemIds.size === 0 && fulfillmentStatus !== "fulfilled") {
          console.log("No line item data in fulfillment payload and order is not fully fulfilled. Skip certificate issue.");
          return;
        }

        await processOrderWebhook(order, {
          allowedLineItemIds: fulfilledLineItemIds,
        });
      } catch (error) {
        console.error("fulfillments-create processing error:", error);
      }
    });
  }
);

app.post(
  "/admin/reissue-line-item",
  express.json({ limit: "1mb" }),
  async (req, res) => {
    try {
      const adminToken = String(req.get("x-admin-token") || req.query.token || "").trim();
      const expectedToken = String(process.env.ADMIN_REISSUE_TOKEN || "").trim();

      if (!expectedToken || adminToken !== expectedToken) {
        return res.status(401).json({
          ok: false,
          error: "Unauthorized",
        });
      }

      const orderId = normalizeOrderId(req.body?.orderId);
      const lineItemId = String(req.body?.lineItemId || "").trim();

      if (!orderId) {
        return res.status(400).json({
          ok: false,
          error: "Missing orderId",
        });
      }

      if (!lineItemId) {
        return res.status(400).json({
          ok: false,
          error: "Missing lineItemId",
        });
      }

      const order = await fetchShopifyOrderForAdmin(orderId);
      const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];

      const item = lineItems.find((lineItem) => {
        return String(lineItem?.id || "") === lineItemId;
      });

      if (!item) {
        return res.status(404).json({
          ok: false,
          error: "Line item not found in this order",
        });
      }

      const result = await issueCertificateForLineItem(order, item);

      return res.status(200).json({
        ok: true,
        orderId: String(order.id),
        orderName: String(order.name || ""),
        lineItemId,
        skipped: Boolean(result.skipped),
        reason: result.reason || "",
        record: result.record,
      });
    } catch (error) {
      console.error("ADMIN REISSUE LINE ITEM ERROR:", error);

      return res.status(500).json({
        ok: false,
        error: error?.message || "Internal Server Error",
      });
    }
  }
);

app.post(
  "/admin/reissue-order",
  express.json({ limit: "1mb" }),
  async (req, res) => {
    try {
      const adminToken = String(req.get("x-admin-token") || req.query.token || "").trim();
      const expectedToken = String(process.env.ADMIN_REISSUE_TOKEN || "").trim();

      if (!expectedToken || adminToken !== expectedToken) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }

      const rawOrderId = req.body?.orderId;
      const orderId = normalizeOrderId(rawOrderId);

      if (!orderId) {
        return res.status(400).json({ ok: false, error: "Missing orderId" });
      }

      const existing = await findIssuedByOrderId(orderId);
      if (existing.length > 0) {
        return res.status(200).json({
          ok: true,
          skipped: true,
          reason: "Already issued",
          orderId,
          records: existing,
        });
      }

      const shop = String(process.env.SHOPIFY_STORE_DOMAIN || "").trim();
      const adminTokenValue = String(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim();

      if (!shop || !adminTokenValue) {
        return res.status(500).json({
          ok: false,
          error: "Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN",
        });
      }

      const endpoint = `https://${shop}/admin/api/2025-01/orders/${orderId}.json?status=any`;

      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": adminTokenValue,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const text = await response.text();
        return res.status(response.status).json({
          ok: false,
          error: "Failed to fetch order from Shopify",
          detail: text,
        });
      }

      const data = await response.json();
      const order = data?.order;

      if (!order?.id) {
        return res.status(404).json({
          ok: false,
          error: "Order not found",
        });
      }

      await processOrderWebhook(order);

      const created = await findIssuedByOrderId(order.id);

      return res.status(200).json({
        ok: true,
        orderId: String(order.id),
        createdCount: created.length,
        records: created,
      });
    } catch (error) {
      console.error("ADMIN REISSUE ERROR:", error);
      return res.status(500).json({
        ok: false,
        error: error?.message || "Internal Server Error",
      });
    }
  }
);

app.post(
  "/admin/resend-collector-access",
  express.json({ limit: "1mb" }),
  async (req, res) => {
    try {
      const adminToken = String(req.get("x-admin-token") || req.query.token || "").trim();
      const expectedToken = String(process.env.ADMIN_REISSUE_TOKEN || "").trim();

      if (!expectedToken || adminToken !== expectedToken) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }

      const orderId = normalizeOrderId(req.body?.orderId);

      if (!orderId) {
        return res.status(400).json({ ok: false, error: "Missing orderId" });
      }

      const result = await resendCollectorAccessByOrderId(orderId);

      if (!result.ok) {
        return res.status(404).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("ADMIN RESEND COLLECTOR ACCESS ERROR:", error);
      return res.status(500).json({
        ok: false,
        error: error?.message || "Internal Server Error",
      });
    }
  }
);

app.post(
  "/admin/regenerate-pdf/:recordId",
  express.json({ limit: "1mb" }),
  async (req, res) => {
    try {
      const adminToken = String(req.get("x-admin-token") || req.query.token || "").trim();
      const expectedToken = String(process.env.ADMIN_REISSUE_TOKEN || "").trim();

      if (!expectedToken || adminToken !== expectedToken) {
        return res.status(401).json({
          ok: false,
          error: "Unauthorized",
        });
      }

      const inputRecordId = String(req.params.recordId || "").trim();

      if (!inputRecordId) {
        return res.status(400).json({
          ok: false,
          error: "Missing recordId",
        });
      }

      const internalId = await resolveInternalIdForAdmin(inputRecordId);

      const file = await readJsonFile(`records/${internalId}/data.json`, null);
      const record = file?.data;

      if (!record) {
        return res.status(404).json({
          ok: false,
          error: "Record data not found",
          internalId,
        });
      }

      record.internalId = record.internalId || internalId;
      record.permanentArchiveUrl =
        record.permanentArchiveUrl ||
        `${ARCHIVE_ASSET_BASE_URL}/records/${internalId}/`;
      record.pdfUrl =
        record.pdfUrl ||
        `${ARCHIVE_ASSET_BASE_URL}/records/${internalId}/certificate.pdf`;
      record.updatedAt = new Date().toISOString();

      const result = await generateAndUploadCertificatePdf(
        internalId,
        record,
        "Regenerate"
      );

      return res.status(200).json({
        ok: true,
        inputRecordId,
        internalId,
        archiveId: record.archiveId || "",
        title: record.title || "",
        pdfUrl: `${result.pdfUrl}?v=${Date.now()}`,
      });
    } catch (error) {
      console.error("ADMIN REGENERATE PDF ERROR:", error);

      return res.status(500).json({
        ok: false,
        error: error?.message || "Internal Server Error",
      });
    }
  }
);
  
async function getPrivateReservationByInternalId(internalId) {
  const reservations = await getReservationsIndex();
  return Object.values(reservations).find((item) => {
    return String(item?.internalId || "").trim() === String(internalId || "").trim();
  }) || null;
}

async function loadCollectorRecord(internalId, token) {
  const cleanInternalId = String(internalId || "").trim().toUpperCase();
  const cleanToken = String(token || "").trim();

  if (!cleanInternalId || !cleanToken) {
    throw new Error("Missing collector token");
  }

  const reservation = await getPrivateReservationByInternalId(cleanInternalId);

  if (!reservation || String(reservation.ownerToken || "").trim() !== cleanToken) {
    const err = new Error("Invalid collector token");
    err.statusCode = 403;
    throw err;
  }

  const file = await readJsonFile(`records/${cleanInternalId}/data.json`, null);
  const publicRecord = file?.data;

  if (!publicRecord) {
    const err = new Error("Record not found");
    err.statusCode = 404;
    throw err;
  }

  return {
    ...publicRecord,
    ownerToken: cleanToken,
    ownerArchiveUrl: buildCollectorUrl(cleanInternalId, cleanToken),
    pdfUrl: buildCollectorPdfUrl(cleanInternalId, cleanToken),
    customerEmail: String(reservation.customerEmail || "").trim(),
    customerFirstName: String(reservation.customerFirstName || "").trim(),
    customerLastName: String(reservation.customerLastName || "").trim(),
  };
}

app.get("/collector/:internalId", async (req, res) => {
  try {
    const internalId = String(req.params.internalId || "").trim().toUpperCase();
    const token = String(req.query.t || "").trim();
    const record = await loadCollectorRecord(internalId, token);
    const html = buildPageHtml(record, record.archiveId || internalId, { isOwner: true });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (error) {
    const status = error.statusCode || 500;
    console.error("COLLECTOR PAGE ERROR:", error);
    return res.status(status).send(status === 403 ? "Invalid collector access" : "Collector record not found");
  }
});

app.get("/collector/:internalId/certificate.pdf", async (req, res) => {
  try {
    const internalId = String(req.params.internalId || "").trim().toUpperCase();
    const token = String(req.query.t || "").trim();
    const record = await loadCollectorRecord(internalId, token);
    const pdfBase64 = await generatePdfBase64(buildPdfHtml(record, { isOwner: true }));
    const buffer = Buffer.from(pdfBase64, "base64");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${record.archiveId || internalId}.pdf"`);
    return res.status(200).send(buffer);
  } catch (error) {
    const status = error.statusCode || 500;
    console.error("COLLECTOR PDF ERROR:", error);
    return res.status(status).send(status === 403 ? "Invalid collector access" : "Collector PDF not found");
  }
});

app.get("/:recordId", async (req, res) => {
  const publicId = String(req.params.recordId || "").trim().toUpperCase();

  if (!publicId) {
    return res.status(400).send("Invalid Record ID");
  }

  try {
    const logFile = await readJsonFile("records-log.json", {});
    const recordsLog = normalizeMap(logFile?.data);
    const internalId = String(recordsLog[publicId] || "").trim();

    if (!internalId) {
      return res.status(404).send("Record not found");
    }

    const file = await readJsonFile(`records/${internalId}/data.json`, null);

    if (!file?.data) {
      return res.status(404).send("Record not found");
    }

    const record = file.data;
    const token = String(req.query.t || "").trim();
    const isOwner = Boolean(token && record.ownerToken && token === record.ownerToken);
    const html = buildPageHtml(record, publicId, { isOwner });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (error) {
    console.error("VERIFY PAGE ERROR:", error);
    return res.status(500).send("Internal Server Error");
  }
});

const MAIL_QUEUE_INTERVAL_MS = Number(
  process.env.MAIL_QUEUE_INTERVAL_MS || 60 * 1000
);

setInterval(() => {
  processMailQueue().catch((error) => {
    console.error("Mail queue interval error:", error);
  });
}, MAIL_QUEUE_INTERVAL_MS);

setTimeout(() => {
  processMailQueue().catch((error) => {
    console.error("Mail queue startup error:", error);
  });
}, 5000);

app.listen(PORT, () => {
  console.log(`GLAMOPH verify listening on :${PORT}`);
});
