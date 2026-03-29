const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const BRANCH = process.env.GITHUB_BRANCH || "main";
const TOKEN = process.env.GITHUB_TOKEN;

function assertEnv() {
  if (!OWNER) throw new Error("Missing GITHUB_OWNER");
  if (!REPO) throw new Error("Missing GITHUB_REPO");
  if (!TOKEN) throw new Error("Missing GITHUB_TOKEN");
}

function ghHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "glamoph-webhook",
  };
}

function contentApiUrl(path) {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodedPath}`;
}

function encodeJson(obj) {
  return Buffer.from(JSON.stringify(obj, null, 2) + "\n", "utf8").toString(
    "base64"
  );
}

async function getFile(path) {
  assertEnv();

  const res = await fetch(`${contentApiUrl(path)}?ref=${encodeURIComponent(BRANCH)}`, {
    headers: ghHeaders(),
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub getFile failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function commitJsonFile({ path, content, message }) {
  assertEnv();

  const existing = await getFile(path);

  const body = {
    message,
    content: encodeJson(content),
    branch: BRANCH,
  };

  if (existing?.sha) body.sha = existing.sha;

  const res = await fetch(contentApiUrl(path), {
    method: "PUT",
    headers: ghHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub commitJsonFile failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function getRecordsLog() {
  const file = await getFile("records-log.json");
  if (!file) return [];

  const raw = Buffer.from(file.content, "base64").toString("utf8");
  return JSON.parse(raw);
}

async function appendRecordLog(entry) {
  const file = await getFile("records-log.json");
  const current = file
    ? JSON.parse(Buffer.from(file.content, "base64").toString("utf8"))
    : [];

  current.push(entry);

  const body = {
    message: `Update records log: ${entry.artworkId}`,
    content: encodeJson(current),
    branch: BRANCH,
  };

  if (file?.sha) body.sha = file.sha;

  const res = await fetch(contentApiUrl("records-log.json"), {
    method: "PUT",
    headers: ghHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub appendRecordLog failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function getNextEditionNumberFromGitHub({ artworkCode, sizeCode }) {
  const logs = await getRecordsLog();

  const used = logs
    .filter(
      (entry) =>
        typeof entry.artworkId === "string" &&
        entry.artworkId.startsWith(`GLA-${artworkCode}-${sizeCode}-`)
    )
    .map((entry) => {
      const match = entry.artworkId.match(/-(\d{3})$/);
      return match ? Number(match[1]) : 0;
    });

  const max = used.length ? Math.max(...used) : 0;
  return max + 1;
}

module.exports = {
  getNextEditionNumberFromGitHub,
  commitJsonFile,
  appendRecordLog,
};
