console.log("🚀 GLAMOPH VERIFY (REDIRECT MODE)");

const express = require("express");

const app = express();

const PORT = process.env.PORT || 3000;

/**
 * ルート
 */
app.get("/", (req, res) => {
  res.send("GLAMOPH Verify System");
});

/**
 * Verifyルート（コア）
 */
app.get("/:archiveId", (req, res) => {
  const archiveId = String(req.params.archiveId || "").trim().toUpperCase();

  if (!archiveId) {
    return res.status(400).send("Invalid Archive ID");
  }

  /**
   * 👉 GitHub Pages にリダイレクト
   * ※ここが今回の本質
   */
  const redirectUrl = `https://glamoph.github.io/glamoph-archive/?id=${archiveId}`;

  console.log("Redirecting to:", redirectUrl);

  return res.redirect(redirectUrl);
});

/**
 * 起動
 */
app.listen(PORT, () => {
  console.log(`GLAMOPH verify listening on :${PORT}`);
});
