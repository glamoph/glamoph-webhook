const express = require("express");

const app = express();

// ShopifyはJSON送ってくるので必須
app.use(express.json());

// ★PORT（Railway用）
const PORT = process.env.PORT || 8080;

// 動作確認用
app.get("/", (req, res) => {
  res.send("GLAMOPH webhook running");
});

// 本体
app.post("/webhooks/shopify/orders-paid", (req, res) => {
  console.log("Webhook received");

  const order = req.body;

  // ★安全装置（ここ重要）
  if (!order) {
    console.log("No body");
    return res.sendStatus(400);
  }

  // ★支払い判定
  if (order.financial_status !== "paid") {
    console.log("Not paid → skip");
    return res.sendStatus(200);
  }

  console.log("PAID ORDER:", order.name);

  // ★ここが次のコア
  // 仮ログ（中身確認）
  console.log("Items:", order.line_items);

  // TODO:
  // ・作品コード取得
  // ・Edition生成
  // ・JSON生成
  // ・Archive保存

  res.sendStatus(200);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${PORT}`);
});
