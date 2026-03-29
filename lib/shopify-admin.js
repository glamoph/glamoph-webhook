const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

function assertShopifyEnv() {
  if (!SHOP) throw new Error("Missing SHOPIFY_STORE_DOMAIN");
  if (!TOKEN) throw new Error("Missing SHOPIFY_ADMIN_ACCESS_TOKEN");
}

async function shopifyGraphQL(query, variables = {}) {
  assertShopifyEnv();

  const res = await fetch(`https://${SHOP}/admin/api/2026-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();

  if (!res.ok || json.errors) {
    throw new Error(
      `Shopify GraphQL error: ${JSON.stringify(json.errors || json, null, 2)}`
    );
  }

  return json.data;
}

function toProductGid(productId) {
  if (!productId) throw new Error("Missing productId");
  if (String(productId).startsWith("gid://")) return String(productId);
  return `gid://shopify/Product/${productId}`;
}

async function getProductForArchive(productId) {
  const gid = toProductGid(productId);

  const query = `
    query ProductForArchive($id: ID!) {
      product(id: $id) {
        id
        title
        handle
        featuredMedia {
          __typename
          ... on MediaImage {
            image {
              url
              altText
            }
          }
        }
        images(first: 1) {
          nodes {
            url
            altText
          }
        }
        metafield(namespace: "custom", key: "artwork_code") {
          value
        }
      }
    }
  `;

  const data = await shopifyGraphQL(query, { id: gid });
  const product = data.product;

  if (!product) {
    throw new Error(`Product not found: ${productId}`);
  }

  const imageUrl =
    product?.featuredMedia?.image?.url ||
    product?.images?.nodes?.[0]?.url ||
    "";

  if (!imageUrl) {
    throw new Error(`No product image found for productId=${productId}`);
  }

  return {
    id: product.id,
    title: product.title || "",
    handle: product.handle || "",
    artworkCode: String(product?.metafield?.value || "").trim().toUpperCase(),
    imageUrl,
    altText:
      product?.featuredMedia?.image?.altText ||
      product?.images?.nodes?.[0]?.altText ||
      "",
  };
}

module.exports = {
  shopifyGraphQL,
  getProductForArchive,
  toProductGid,
};
