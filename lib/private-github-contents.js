const {
  getFile: getPublicFile,
  getFileSha: getPublicFileSha,
  putFileBase64: putPublicFileBase64,
} = require("./github-contents");

const OWNER = process.env.PRIVATE_GITHUB_OWNER || process.env.GITHUB_PRIVATE_OWNER || "";
const REPO = process.env.PRIVATE_GITHUB_REPO || process.env.GITHUB_PRIVATE_REPO || "";
const BRANCH = process.env.PRIVATE_GITHUB_BRANCH || process.env.GITHUB_PRIVATE_BRANCH || process.env.GITHUB_BRANCH || "main";
const TOKEN = process.env.PRIVATE_GITHUB_TOKEN || process.env.GITHUB_PRIVATE_TOKEN || "";

const FALLBACK_TO_PUBLIC = String(process.env.ALLOW_PUBLIC_PRIVATE_STORE_FALLBACK || "").trim() === "1";

function hasPrivateEnv() {
  return Boolean(OWNER && REPO && TOKEN);
}

function assertPrivateEnv() {
  if (hasPrivateEnv()) return;

  if (FALLBACK_TO_PUBLIC) {
    console.warn(
      "WARNING: Private store env is not configured. Falling back to the public archive repo because ALLOW_PUBLIC_PRIVATE_STORE_FALLBACK=1. Do not use this in production."
    );
    return;
  }

  throw new Error(
    "Missing private storage configuration. Set PRIVATE_GITHUB_OWNER, PRIVATE_GITHUB_REPO and PRIVATE_GITHUB_TOKEN. Sensitive data must not be stored in the public archive repo."
  );
}

function ghHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "glamoph-private-store",
  };
}

function contentsUrl(path) {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodedPath}`;
}

async function getPrivateFile(path) {
  assertPrivateEnv();

  if (!hasPrivateEnv() && FALLBACK_TO_PUBLIC) {
    return getPublicFile(path);
  }

  const res = await fetch(
    `${contentsUrl(path)}?ref=${encodeURIComponent(BRANCH)}`,
    {
      method: "GET",
      headers: ghHeaders(),
    }
  );

  if (res.status === 404) return null;

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Private GitHub getFile failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function getPrivateFileSha(path) {
  if (!hasPrivateEnv() && FALLBACK_TO_PUBLIC) {
    return getPublicFileSha(path);
  }

  const file = await getPrivateFile(path);
  return file?.sha || null;
}

async function putPrivateFileBase64({ path, base64Content, message }) {
  assertPrivateEnv();

  if (!hasPrivateEnv() && FALLBACK_TO_PUBLIC) {
    return putPublicFileBase64({ path, base64Content, message });
  }

  const sha = await getPrivateFileSha(path);

  const body = {
    message,
    content: base64Content,
    branch: BRANCH,
  };

  if (sha) body.sha = sha;

  const res = await fetch(contentsUrl(path), {
    method: "PUT",
    headers: ghHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Private GitHub putFileBase64 failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function readPrivateJsonFile(path, fallback = null) {
  const file = await getPrivateFile(path);

  if (!file) {
    return {
      exists: false,
      sha: null,
      data: fallback,
    };
  }

  const raw = Buffer.from(file.content, "base64").toString("utf8");

  return {
    exists: true,
    sha: file.sha || null,
    data: JSON.parse(raw),
  };
}

async function writePrivateJsonFile(path, data, message) {
  const base64Content = Buffer.from(
    JSON.stringify(data, null, 2) + "\n",
    "utf8"
  ).toString("base64");

  return putPrivateFileBase64({
    path,
    base64Content,
    message,
  });
}

module.exports = {
  hasPrivateEnv,
  getPrivateFile,
  getPrivateFileSha,
  putPrivateFileBase64,
  readPrivateJsonFile,
  writePrivateJsonFile,
};
