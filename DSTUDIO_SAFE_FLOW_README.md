# GLAMOPH dStudio-safe Archive Flow

## What changed

This version separates edition reservation from certificate notification.

- Order paid: reserve an edition number privately.
- Before production: use the reserved number to create the numbered print file for dStudio.
- Fulfillment with tracking: publish the public Archive Record and queue the Collector Record email.
- Collector URL and owner token are not stored in the public archive files.

## New private storage requirement

Create a private GitHub repository and set these environment variables:

- `PRIVATE_GITHUB_OWNER`
- `PRIVATE_GITHUB_REPO`
- `PRIVATE_GITHUB_BRANCH`
- `PRIVATE_GITHUB_TOKEN`

Private files created by the app:

- `private/edition-reservations.json`
- `private/issued-index.json`
- `private/order-contact-index.json`
- `private/mail-queue.json`

Do not store these in the public `glamoph-archive` repository.

## Admin reservation viewer

Open:

`https://<your webhook app domain>/reservations.html`

Use `ADMIN_REISSUE_TOKEN` as the Admin Token.

You can:

- reserve an order manually,
- view reserved edition numbers,
- copy dStudio folder/file names,
- mark print file ready,
- mark sent to dStudio,
- mark cancelled.

## Shopify webhooks

Recommended topics:

- `orders/paid` → `/webhooks/orders-paid`
- `orders/create` → `/webhooks/orders-create`
- `orders/cancelled` → `/webhooks/orders-cancelled`
- `fulfillments/create` → `/webhooks/fulfillments-create`

## dStudio file workflow

For each reservation, create a Google Drive / Dropbox folder using the generated folder name:

`#ORDER_PUBLICID`

Example:

`1063_GLA-WHTORG-S-002`

Recommended files:

- `GLAMOPH_GLA-WHTORG-S-002_WHTORG_S_PRINT.tif`
- `GLAMOPH_GLA-WHTORG-S-002_COA_A5.pdf`
- `GLAMOPH_GLA-WHTORG-S-002_ORDER_NOTES.txt`

Then email dStudio that the order is ready to proceed.

## Privacy model

Public archive files contain no customer email/name and no owner token.

Collector access is served dynamically:

`https://verify.glamoph.com/collector/<internalId>?t=<ownerToken>`

The collector PDF is also dynamic:

`https://verify.glamoph.com/collector/<internalId>/certificate.pdf?t=<ownerToken>`

## Cancellation policy

When an order is cancelled before fulfillment, the reservation is marked `cancelled` in private storage. It does not automatically decrement the edition counter or reuse the number. Reuse should be a manual curatorial decision.
