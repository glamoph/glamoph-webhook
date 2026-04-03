const express = require('express');
const path = require('path');

const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// =============================
// ENV
// =============================

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const VERIFY_PUBLIC_BASE_URL =
  process.env.VERIFY_PUBLIC_BASE_URL || "https://verify.glamoph.com";

// =============================
// Helpers
// =============================

function normalizeOrderId(value) {
  return String(value || '').trim().replace(/^#/, '');
}

function extractArtworkCodeFromSku(sku) {
  if (!sku) return '';
  return sku.split('-')[1] || '';
}

function extractSizeFromSku(sku) {
  if (!sku) return '';
  return sku.split('-')[2] || '';
}

async function shopifyFetch(pathname) {
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-01${pathname}`;

  const res = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) {
    throw new Error('Shopify API error');
  }

  return res.json();
}

async function findOrder(orderId) {
  const id = normalizeOrderId(orderId);

  if (/^\d+$/.test(id)) {
    try {
      const data = await shopifyFetch(`/orders/${id}.json?status=any`);
      if (data.order) return data.order;
    } catch {}
  }

  throw new Error('Order not found');
}

function buildDraft(order) {
  const item = order.line_items[0];

  const sku = item.sku;
  const artworkCode = extractArtworkCodeFromSku(sku);
  const size = extractSizeFromSku(sku);

  return {
    sku,
    artworkCode,
    size,
    title: item.title,
    image: `/images/${artworkCode}.jpg`,
    artist: "GLAMOPH",
    frame: "Black",
    medium: "Archival pigment print on fine art paper"
  };
}

// =============================
// ORDER LOAD
// =============================

app.get('/admin/order-detail', async (req, res) => {
  try {
    const order = await findOrder(req.query.orderId);
    const draft = buildDraft(order);

    res.json({
      ok: true,
      draft
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =============================
// PUBLISH (mock)
// =============================

app.post('/api/publish', (req, res) => {
  const {
    artworkCode,
    size,
    title,
    editionNumber
  } = req.body;

  const edition = Math.max(1, Number(editionNumber || 1));

  const artworkId = `GLA-${artworkCode}-${size}-${String(edition).padStart(3, '0')}`;

  res.json({
    ok: true,
    record: {
      artworkId,
      title
    }
  });
});

// =============================

app.listen(3000, () => {
  console.log('Server running');
});
