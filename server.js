const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("GLAMOPH webhook running");
});

app.post("/webhooks/shopify/orders-paid", (req, res) => {
  console.log("Webhook received");
  res.status(200).send("OK");
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
