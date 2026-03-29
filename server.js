console.log("🚀 GLAMOPH VERIFY (REDIRECT MODE)");

const express = require("express");

const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("GLAMOPH Verify System");
});

app.get("/:archiveId", (req, res) => {
  const archiveId = String(req.params.archiveId || "").trim().toUpperCase();

  if (!archiveId) {
    return res.status(400).send("Invalid Archive ID");
  }

  const redirectUrl = `https://glamoph.github.io/glamoph-archive/?id=${archiveId}`;

  console.log("Redirecting to:", redirectUrl);

  return res.redirect(redirectUrl);
});

app.listen(PORT, () => {
  console.log(`GLAMOPH verify listening on :${PORT}`);
});
