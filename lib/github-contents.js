const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const BRANCH = process.env.GITHUB_BRANCH || "main";
const TOKEN = process.env.GITHUB_TOKEN;

function assertGitHubEnv() {
  if (!OWNER) throw new Error("Missing GITHUB_OWNER");
  if (!REPO) throw new Error("Missing GITHUB_REPO");
  if (!TOKEN) throw new Error("Missing GITHUB_TOKEN");
}

function ghHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "glamoph-archive-sync",
  };
}

function contentsUrl(path) {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodedPath}`;
}

async function getFile(path) {
  assertGitHubEnv();

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
    throw new Error(`GitHub getFile failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function getFileSha(path) {
  const file = await getFile(path);
  return file?.sha || null;
}

async function putFileBase64({ path, base64Content, message }) {
  assertGitHubEnv();

  const sha = await getFileSha(path);

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
    throw new Error(`GitHub putFileBase64 failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function readJsonFile(path, fallback = null) {
  const file = await getFile(path);

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

async function writeJsonFile(path, data, message) {
  const base64Content = Buffer.from(
    JSON.stringify(data, null, 2) + "\n",
    "utf8"
  ).toString("base64");

  return putFileBase64({
    path,
    base64Content,
    message,
  });
}

module.exports = {
  getFile,
  getFileSha,
  putFileBase64,
  readJsonFile,
  writeJsonFile,
};
