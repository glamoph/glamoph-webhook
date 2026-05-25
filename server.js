console.log("🚀 GLAMOPH VERIFY (DIRECT RENDER + WEBHOOK)");

const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { Resend } = require("resend");
const puppeteer = require("puppeteer-core");
const { execSync } = require("child_process");

const { verifyShopifyWebhook } = require("./lib/webhook-verify");
const { readJsonFile, writeJsonFile, putFileBase64 } = require("./lib/github-contents");
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
  const pdfUrl = `${ARCHIVE_ASSET_BASE_URL}/records/${record.internalId}/certificate.pdf`;
  const ownerToken = escapeHtml(record.ownerToken || "");

  return buildPageHtml(record, record.archiveId, { isOwner: true })
    .replace('href="/archive.css"', `href="${ARCHIVE_ASSET_BASE_URL}/public/archive.css"`)
    .replace('src="/assets/signature.png"', `src="${ARCHIVE_ASSET_BASE_URL}/public/assets/signature.png"`)
    .replace(
      '<button class="archive-download" type="button" onclick="window.print()">Download PDF</button>',
      `<a class="archive-download" href="${pdfUrl}" target="_blank" rel="noopener noreferrer">Download PDF</a>`
    )
    .replace(
      "</head>",
      `<style>
        .archive-signature-wrap {
          display: none;
        }

        html.is-owner .archive-signature-wrap {
          display: block;
        }
      </style>
      <script>
        (function () {
          var params = new URLSearchParams(window.location.search);
          var token = params.get("t") || "";
          var ownerToken = "${ownerToken}";

          if (token && ownerToken && token === ownerToken) {
            document.documentElement.classList.add("is-owner");
          }
        })();
      </script>
      </head>`
    );
}

function buildPdfHtml(record) {
  const pdfUrl = `${ARCHIVE_ASSET_BASE_URL}/records/${record.internalId}/certificate.pdf`;

  return buildPageHtml(record, record.archiveId, { isOwner: true })
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

  const pdfHtml = buildPdfHtml(record);

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

async function getIssuedIndex() {
  const file = await readJsonFile("issued-index.json", {});
  return normalizeMap(file.data);
}

async function updateIssuedIndex(lineItemId, payload) {
  const current = await getIssuedIndex();
  current[String(lineItemId)] = payload;

  await writeJsonFile(
    "issued-index.json",
    current,
    `Update issued index: ${lineItemId}`
  );
}

async function getOrderContactIndex() {
  const file = await readJsonFile("order-contact-index.json", {});
  return normalizeMap(file.data);
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

  await writeJsonFile(
    "order-contact-index.json",
    current,
    `Save order contact: ${orderName || orderId}`
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

async function createRecordFile(internalId, record) {
  record.permanentArchiveUrl =
    `${ARCHIVE_ASSET_BASE_URL}/records/${internalId}/`;
  record.pdfUrl = `${ARCHIVE_ASSET_BASE_URL}/records/${internalId}/certificate.pdf`;

  await writeJsonFile(
    `records/${internalId}/data.json`,
    record,
    `Create record data: ${internalId}`
  );

  const staticHtml = buildStaticPageHtml(record);

  await putFileBase64({
    path: `records/${internalId}/index.html`,
    base64Content: Buffer.from(staticHtml, "utf8").toString("base64"),
    message: `Create record page: ${internalId}`,
  });

  try {
    await generateAndUploadCertificatePdf(internalId, record, "Create");
  } catch (error) {
    console.error("PDF generation failed:", internalId, error?.message || error);
  }
}

function normalizeOrderId(value) {
  return String(value || "").trim();
}

async function findIssuedByOrderId(orderId) {
  const file = await readJsonFile("issued-index.json", {});
  const issuedIndex = normalizeMap(file.data);

  return Object.values(issuedIndex).filter((item) => {
    return normalizeOrderId(item?.orderId) === normalizeOrderId(orderId);
  });
}


async function issueCertificateForLineItem(order, item) {
  const orderId = order?.id;
  const orderName = order?.name || "";
  const createdAt = order?.created_at || new Date().toISOString();

  if (!orderId) {
    throw new Error("Missing orderId");
  }

  const lineItemId = item?.id;

  if (!lineItemId) {
    throw new Error("Missing lineItemId");
  }

  const issuedIndex = await getIssuedIndex();

  if (issuedIndex[String(lineItemId)]) {
    const existing = issuedIndex[String(lineItemId)];

    return {
      ok: true,
      skipped: true,
      reason: "Already issued",
      record: existing,
    };
  }

  if (!isArtworkLineItem(item)) {
    throw new Error("Selected line item is not an artwork item");
  }

  const sku = String(item?.sku || "").trim().toUpperCase();
  const productId = item?.product_id;
  const title = String(item?.title || "").trim();
  const variantTitle = String(item?.variant_title || "").trim().toUpperCase();

  if (!sku) {
    throw new Error("Selected line item has no SKU");
  }

  const parsed = parseSku(sku);

  if (!parsed.valid) {
    throw new Error(`Invalid SKU format: ${sku}`);
  }

  const artworkCode = parsed.artworkCode;
  let sizeCode = parsed.sizeCode;
  const frameCode = parsed.frameCode;

  if (!sizeCode) {
    if (/\bS\b/.test(variantTitle)) sizeCode = "S";
    else if (/\bM\b/.test(variantTitle)) sizeCode = "M";
    else if (/\bL\b/.test(variantTitle)) sizeCode = "L";
  }

  if (!artworkCode || !sizeCode) {
    throw new Error("Could not resolve artworkCode / size from selected item");
  }

  if (!productId) {
    throw new Error("Selected line item has no product_id");
  }

  const directContact = extractOrderContact(order);
  const savedContact = await getSavedOrderContact(orderId);

  const customerEmail = String(
    directContact.email ||
    savedContact?.email ||
    ""
  ).trim();

  const customerFirstName = String(
    directContact.firstName ||
    savedContact?.firstName ||
    ""
  ).trim();

  const customerLastName = String(
    directContact.lastName ||
    savedContact?.lastName ||
    ""
  ).trim();

  const { editionNumber, editionTotal } = await getNextEdition({
    artworkCode,
    sizeCode,
  });

  const publicId = buildPublicId({
    artworkCode,
    sizeCode,
    editionNumber,
  });

  const internalId = buildInternalId(publicId);

  let imageResult = {
    filePath: `images/${artworkCode}.jpg`,
  };

  try {
    const syncedImage = await syncProductFeaturedImageToGitHub(productId, artworkCode);
    if (syncedImage?.filePath) imageResult = syncedImage;
  } catch (error) {
    console.error("Image sync failed:", error);
  }

  const ownerToken = crypto.randomBytes(6).toString("hex");
  const publicArchiveUrl = `${ARCHIVE_ASSET_BASE_URL}/records/${internalId}/`;
  const ownerArchiveUrl = `${ARCHIVE_ASSET_BASE_URL}/records/${internalId}/?t=${ownerToken}`;

  const record = {
    verified: "Archive Record",
    title,
    archiveId: publicId,
    internalId,
    edition: `${pad2(editionNumber)} / ${editionTotal}`,
    editionNumber,
    editionTotal,
    artist: "GLAMOPH",
    medium: "Giclée print on museum-quality fine art paper",
    size: resolveSizeLabel(sizeCode),
    frame: frameCode === "BLK" ? "Black" : "White",
    archiveDate: formatArchiveDate(createdAt),
    archiveUrl: publicArchiveUrl,
    ownerArchiveUrl,
    image: `/${imageResult.filePath}`,
    artworkCode,
    sizeCode,
    shopifyOrderId: orderId,
    orderName,
    lineItemId,
    sku,
    createdAt,
    updatedAt: new Date().toISOString(),
    ownerToken,
    customerEmail,
    customerFirstName,
    customerLastName,
    locale: String(order?.customer_locale || order?.locale || "").trim().toLowerCase(),
    shippingCountryCode: String(order?.shipping_address?.country_code || "").trim().toUpperCase(),
    billingCountryCode: String(order?.billing_address?.country_code || "").trim().toUpperCase(),
  };

  await createRecordFile(internalId, record);
  await updateRecordsLog(publicId, internalId);

  await updateIssuedIndex(lineItemId, {
    publicId,
    internalId,
    orderId,
    orderName,
    sku,
    createdAt,
  });

  return {
    ok: true,
    skipped: false,
    record,
  };
}


async function resendCollectorAccessByOrderId(orderId) {
  const existing = await findIssuedByOrderId(orderId);

  if (!existing.length) {
    return {
      ok: false,
      error: "No issued record found for this orderId",
    };
  }

  const results = [];

  for (const item of existing) {
    const internalId = String(item?.internalId || "").trim();
    if (!internalId) continue;

    const file = await readJsonFile(`records/${internalId}/data.json`, null);
    const record = file?.data;

    if (!record) {
      results.push({
        ok: false,
        internalId,
        error: "Record data not found",
      });
      continue;
    }

    await sendCollectorAccessEmail(record);

    results.push({
      ok: true,
      internalId,
      archiveId: record.archiveId || "",
      title: record.title || "",
      email: record.customerEmail || "",
      ownerArchiveUrl: record.ownerArchiveUrl || "",
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

async function processOrderWebhook(order) {
  const orderId = order?.id;
  const orderName = order?.name || "";
  const createdAt = order?.created_at || new Date().toISOString();

  const directContact = extractOrderContact(order);
  const savedContact = await getSavedOrderContact(orderId);

  const customerEmail = String(
    directContact.email ||
    savedContact?.email ||
    ""
  ).trim();

  const customerFirstName = String(
    directContact.firstName ||
    savedContact?.firstName ||
    ""
  ).trim();

  const customerLastName = String(
    directContact.lastName ||
    savedContact?.lastName ||
    ""
  ).trim();

  console.log("EMAIL DEBUG:", {
    orderId,
    orderName,
    direct_email: directContact.email || "",
    saved_email: savedContact?.email || "",
    resolved: customerEmail,
  });
  
  const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];

  console.log("ORDER ID:", orderId);
  console.log("ORDER NAME:", orderName);
  console.log("LINE ITEMS:", lineItems.length);

  if (!orderId || lineItems.length === 0) {
    console.log("No order id or line items. Skip.");
    return;
  }

  const issuedIndex = await getIssuedIndex();

  for (const item of lineItems) {
    const lineItemId = item?.id;
    if (!lineItemId) continue;

    if (issuedIndex[String(lineItemId)]) {
      console.log("Already issued. Skip:", lineItemId);
      continue;
    }

    const sku = String(item?.sku || "").trim().toUpperCase();
    const productId = item?.product_id;
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

    if (looksLikeNonArtwork) {
      console.log("Skip non-artwork line item:", { title, sku, variantTitle });
      continue;
    }

    let artworkCode = "";
    let sizeCode = "";
    let frameCode = "";

    if (sku) {
      const parsed = parseSku(sku);

      if (!parsed.valid) {
        console.log("Invalid SKU format:", sku);
        continue;
      }

      artworkCode = parsed.artworkCode;
      sizeCode = parsed.sizeCode;
      frameCode = parsed.frameCode;
    }

    if (!artworkCode) {
      console.log("No artworkCode resolved from SKU/title");
    }

    if (!sizeCode) {
      if (/\bS\b/.test(variantTitle)) sizeCode = "S";
      else if (/\bM\b/.test(variantTitle)) sizeCode = "M";
      else if (/\bL\b/.test(variantTitle)) sizeCode = "L";
    }

    if (!artworkCode || !sizeCode) {
      console.log("Skip line item due to unresolved artwork/size:", {
        title,
        sku,
        variantTitle,
      });
      continue;
    }

    if (!productId) {
      console.log("Skip line item due to missing product_id:", lineItemId);
      continue;
    }

    const { editionNumber, editionTotal } = await getNextEdition({
      artworkCode,
      sizeCode,
    });

    const publicId = buildPublicId({
      artworkCode,
      sizeCode,
      editionNumber,
    });

    const internalId = buildInternalId(publicId);

    console.log("ISSUE START:", publicId);

    let imageResult = {
      filePath: `images/${artworkCode}.jpg`,
    };

    try {
      const syncedImage = await syncProductFeaturedImageToGitHub(productId, artworkCode);
      if (syncedImage?.filePath) imageResult = syncedImage;
    } catch (error) {
      console.error("Image sync failed:", error);
    }

    const ownerToken = crypto.randomBytes(6).toString("hex");
    const publicArchiveUrl = `${ARCHIVE_ASSET_BASE_URL}/records/${internalId}/`;
    const ownerArchiveUrl = `${ARCHIVE_ASSET_BASE_URL}/records/${internalId}/?t=${ownerToken}`;

    const record = {
      verified: "Archive Record",
      title,
      archiveId: publicId,
      internalId,
      edition: `${pad2(editionNumber)} / ${editionTotal}`,
      editionNumber,
      editionTotal,
      artist: "GLAMOPH",
      medium: "Giclée print on museum-quality fine art paper",
      size: resolveSizeLabel(sizeCode),
      frame: frameCode === "BLK" ? "Black" : "White",
      archiveDate: formatArchiveDate(createdAt),
      archiveUrl: publicArchiveUrl,
      ownerArchiveUrl,
      image: `/${imageResult.filePath}`,
      artworkCode,
      sizeCode,
      shopifyOrderId: orderId,
      orderName,
      lineItemId,
      sku,
      createdAt,
      updatedAt: new Date().toISOString(),
      ownerToken,
            customerEmail,
      customerFirstName,
      customerLastName,
      locale: String(order?.customer_locale || order?.locale || "").trim().toLowerCase(),
      shippingCountryCode: String(order?.shipping_address?.country_code || "").trim().toUpperCase(),
      billingCountryCode: String(order?.billing_address?.country_code || "").trim().toUpperCase(),
    };

    await createRecordFile(internalId, record);
    await updateRecordsLog(publicId, internalId);

    await updateIssuedIndex(lineItemId, {
  publicId,
  internalId,
  orderId,
  orderName,
  sku,
  createdAt,
});

// 証明書メールは、発送通知の約10分後に送信する
setTimeout(async () => {
  try {
    await sendCollectorAccessEmail(record);
  } catch (error) {
    console.error("Delayed collector email error:", error);
  }
}, 10 * 60 * 1000);

console.log("Issued:", publicId, "=>", internalId);
console.log("Collector email scheduled:", publicId, "in 10 minutes");
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
  } catch (error) {
    console.error("orders-paid contact save error:", error);
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

        const fulfillmentStatus = String(order?.fulfillment_status || "").trim().toLowerCase();

        console.log("ORDER FULFILLMENT STATUS:", fulfillmentStatus || "(empty)");

        if (fulfillmentStatus !== "fulfilled") {
          console.log("Order is not fully fulfilled yet. Skip certificate issue.");
          return;
        }

        await processOrderWebhook(order);
      } catch (error) {
        console.error("fulfillments-create processing error:", error);
      }
    });
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

app.listen(PORT, () => {
  console.log(`GLAMOPH verify listening on :${PORT}`);
});
