const express = require("express");

const app = express();

// ★ここが超重要
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  res.send("GLAMOPH webhook running");
});

app.post("/webhooks/shopify/orders-paid", (req, res) => {
  console.log("Webhook received");
  res.status(200).send("OK");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${PORT}`);
});
