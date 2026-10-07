// Данные читаются прямо из репозитория по SHA последнего коммита main: новый пуш виден сразу,
// без пересборки Pages. URL по SHA неизменяем, поэтому кэш raw (~5 мин) не отдаёт старое.
// Без SHA (API недоступен или лимит 60 запросов/час) — файлы из деплоя Pages, могут быть старыми.

const REPO = "kmarkov563/sport";
const SHA_FRESH_MS = 30_000;
const FRESH_SHA_KEY = "data-sha-fresh";
const LAST_SHA_KEY = "data-sha-last";

let shaRequest = null;

export function fetchData(path) {
  shaRequest ??= latestSha();
  return shaRequest.then(sha => sha
    ? fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/${path}`)
    : fetch(path, { cache: "no-store" }));
}

async function latestSha() {
  const fresh = readStorage("sessionStorage", FRESH_SHA_KEY);
  if (fresh && Date.now() - fresh.at < SHA_FRESH_MS) return fresh.sha;
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
      headers: { Accept: "application/vnd.github.sha" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`GitHub API: HTTP ${response.status}`);
    const sha = (await response.text()).trim();
    writeStorage("sessionStorage", FRESH_SHA_KEY, { sha, at: Date.now() });
    writeStorage("localStorage", LAST_SHA_KEY, sha);
    return sha;
  } catch {
    return readStorage("localStorage", LAST_SHA_KEY);
  }
}

// Хранилище может быть недоступно (приватный режим, запрет сайта): даже обращение к нему бросает исключение.
function readStorage(storage, key) {
  try {
    return JSON.parse(window[storage].getItem(key));
  } catch {
    return null;
  }
}

function writeStorage(storage, key, value) {
  try {
    window[storage].setItem(key, JSON.stringify(value));
  } catch {
    // без кэша SHA страница всё равно работает
  }
}
