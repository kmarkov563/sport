/* Service worker: офлайн-режим для Sport_BB.
   Стратегия — «сначала сеть, при отсутствии интернета отдаём сохранённую копию».
   При онлайне всегда грузится свежая версия и обновляется кэш.
   Ответ из кэша помечается заголовком X-Offline:1, чтобы страница показала баннер. */

const CACHE = "sport-bb-v1";

// Файлы, которые кладём в кэш сразу при установке,
// чтобы сайт открывался даже при первом офлайн-запуске после визита.
const PRECACHE = [
  "./",
  "index.html",
  "coach.html",
  "coach-man.html",
  "coach-women.html",
  "home/home-man.html",
  "home/home-woman.html",
  "home/home-man-plan.json",
  "assets/might_guy.webp",
  "log/man/index.json",
  "log/man/0001.json",
  "log/man/0002.json",
  "log/women/index.json",
  "log/women/0001.json",
  "log/women/0002.json",
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Кэшируем по одному, чтобы отсутствие одного файла не сорвало установку.
    await Promise.allSettled(PRECACHE.map(url => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Копия ответа с пометкой, что он взят из офлайн-кэша.
async function markOffline(response) {
  const body = await response.blob();
  const headers = new Headers(response.headers);
  headers.set("X-Offline", "1");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  // Обрабатываем только собственные GET-запросы.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // Есть сеть — берём свежее и обновляем кэш.
      const fresh = await fetch(request);
      if (fresh && fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    } catch (error) {
      // Нет сети — отдаём сохранённую копию с пометкой офлайн.
      const cached = await cache.match(request, { ignoreSearch: false })
        || await cache.match(request, { ignoreSearch: true });
      if (cached) return markOffline(cached);
      // Для навигации — фолбэк на сохранённую страницу приложения.
      if (request.mode === "navigate") {
        const shell = await cache.match("index.html");
        if (shell) return markOffline(shell);
      }
      throw error;
    }
  })());
});
