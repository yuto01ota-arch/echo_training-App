import { AUTH } from "../src/config.js";
import { editorAPI, publicCatalog, json } from "./catalog.js";
const encoder = new TextEncoder();
const COOKIE = "__Host-echo_developer";

const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};
const loginScript = `import * as theme from "/theme.js";
theme.initializeTheme();
{
  const toggle = document.querySelector("[data-theme-toggle]");
  const update = () => {
    const dark = theme.preferredTheme() === "dark";
    toggle.textContent = dark ? "ライトモード" : "ダークモード";
    toggle.setAttribute("aria-label", toggle.textContent + "に切り替え");
    document.querySelectorAll("header a").forEach(link => link.href = theme.themeURL(link.href));
    document.querySelectorAll("form").forEach(form => form.action = theme.themeURL(form.action));
  };
  toggle.addEventListener("click", () => {
    const next = theme.preferredTheme() === "dark" ? "light" : "dark";
    theme.saveTheme(next);
    theme.applyTheme(next);
    update();
  });
  update();
}`;
const style = `body{margin:0;background:var(--page,#f7f9fa);color:var(--text,#273d43);font:16px/1.6 system-ui,sans-serif}header{padding:12px 24px;background:var(--surface,white);border-bottom:1px solid var(--border,#dce5e7);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}a{color:var(--accent,#246a63)}main{max-width:380px;margin:48px auto;padding:24px;background:var(--surface,white);border:1px solid var(--border,#dce5e7);border-radius:10px}h1{font-size:22px;margin:0 0 16px}label{display:block;margin-bottom:6px}input{background:var(--surface,white);color:inherit;box-sizing:border-box;width:100%;padding:10px;font:inherit;border:1px solid var(--border,#a9c1c4);border-radius:6px}button{font:inherit;color:var(--accent,#246a63);background:var(--selected,#e9f3f0);border:1px solid var(--accent-border,#70a69d);border-radius:6px;padding:8px 16px;cursor:pointer}main button{width:100%;margin-top:16px}[role=alert]{color:var(--error,#a9362a)}.blank{max-width:none;border:0;border-radius:0;margin:0;min-height:calc(100dvh - 100px)}@media(max-width:480px){main{margin:24px 16px}}`;
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const hex = (bytes) =>
  Array.from(new Uint8Array(bytes), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");

function publicURL(env) {
  try {
    const url = new URL(env.PUBLIC_APP_URL);
    if (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
      return url.href;
  } catch {
    /* No untrusted schemes in the return link. */
  }
  return "https://yuto01ota-arch.github.io/echo_training-App/";
}

function documentHTML(env, content, unlocked, nonce) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f7f9fa"><meta name="robots" content="noindex,nofollow"><title>開発者用ページ | ECHO TRAINING</title><link rel="stylesheet" href="/theme.css"><style>${style}</style><script type="module" nonce="${nonce}">${loginScript}</script></head><body><header><a href="${escape(publicURL(env))}">← 部位選択に戻る</a><button type="button" data-theme-toggle>表示モード切り替え</button>${unlocked ? '<form method="post" action="/logout"><button type="submit">ログアウト</button></form>' : ""}</header>${content}</body></html>`;
}

function pageResponse(env, content, status = 200, unlocked = false) {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(AUTH.nonceBytes)));
  return new Response(documentHTML(env, content, unlocked, nonce), {
    status,
    headers: {
      ...headers,
      "Content-Security-Policy": `${headers["Content-Security-Policy"]}; script-src 'self' 'nonce-${nonce}'`,
    },
  });
}

function login(env, message = "", status = 200) {
  return pageResponse(
    env,
    `<main><h1>開発者用ページ</h1><p>パスワードを入力してください。</p><form method="post" action="/login"><label for="password">パスワード</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="${AUTH.maxPasswordLength}" autofocus>${message ? `<p role="alert">${escape(message)}</p>` : ""}<button type="submit">開く</button></form></main>`,
    status,
  );
}

function redirect(path, cookie) {
  return new Response(null, {
    status: 303,
    headers: {
      ...headers,
      Location: path,
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    },
  });
}

function sessionCookie(token, maxAge = AUTH.sessionSeconds) {
  return `${COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

async function keyFor(env) {
  // Changing either secret invalidates all existing sessions.
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(
      JSON.stringify([env.SESSION_SECRET, env.DEVELOPER_PASSWORD]),
    ),
  );
  return crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function newSession(env) {
  const expires = Math.floor(Date.now() / 1000) + AUTH.sessionSeconds;
  const nonce = hex(crypto.getRandomValues(new Uint8Array(AUTH.nonceBytes)));
  const payload = `${expires}.${nonce}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await keyFor(env),
    encoder.encode(payload),
  );
  return `${payload}.${hex(signature)}`;
}

async function authenticated(request, env) {
  const token = (request.headers.get("Cookie") || "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!token || !new RegExp(`^\\d{10}\\.[a-f0-9]{${AUTH.nonceBytes * 2}}\\.[a-f0-9]{64}$`).test(token))
    return false;
  const [expires, nonce, signature] = token.split(".");
  const now = Math.floor(Date.now() / 1000);
  if (Number(expires) <= now || Number(expires) > now + AUTH.sessionSeconds)
    return false;
  return crypto.subtle.verify(
    "HMAC",
    await keyFor(env),
    Uint8Array.from(signature.match(/../g), (byte) => parseInt(byte, 16)),
    encoder.encode(`${expires}.${nonce}`),
  );
}

async function passwordMatches(candidate, expected) {
  const hashes = await Promise.all(
    [candidate, expected].map((value) =>
      crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
  const left = new Uint8Array(hashes[0]),
    right = new Uint8Array(hashes[1]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

async function readForm(request) {
  if (
    !request.headers
      .get("Content-Type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > AUTH.maxFormBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // These two files contain only shared display preferences/styles, never editor content.
    if (request.method === "GET" && ["/theme.js", "/theme.css"].includes(url.pathname)) {
      if (!env.ASSETS) return new Response("Not Found", { status: 404 });
      const response = await env.ASSETS.fetch(request);
      const publicAsset = new Response(response.body, response);
      publicAsset.headers.set("Cache-Control", "no-store");
      publicAsset.headers.set("X-Content-Type-Options", "nosniff");
      return publicAsset;
    }
    // Only the two public display preferences may cross authentication redirects.
    const theme = url.searchParams.get("theme");
    const themed = path => theme === "dark" || theme === "light" ? `${path}?theme=${theme}` : path;
    if (url.pathname.startsWith("/public/")) return publicCatalog(request, env);
    if (
      typeof env.DEVELOPER_PASSWORD !== "string" ||
      env.DEVELOPER_PASSWORD.length < AUTH.minPasswordLength ||
      typeof env.SESSION_SECRET !== "string" ||
      env.SESSION_SECRET.length < AUTH.minSessionSecretLength ||
      !env.LOGIN_LIMITER
    ) {
      return pageResponse(env, "<main><h1>開発者用ページ</h1><p>現在は利用できません。</p></main>", 503);
    }
    if (url.pathname.startsWith("/api/")) {
      if (!(await authenticated(request, env)))
        return json(
          {
            error: "ログインの有効期限が切れました。ログインし直してください。",
          },
          401,
        );
      if (
        request.method !== "GET" &&
        request.headers.get("Origin") !== url.origin
      )
        return json({ error: "Forbidden" }, 403);
      if (url.pathname === "/api/settings" && request.method === "GET")
        return json({ publicURL: publicURL(env) });
      return editorAPI(request, env);
    }
    if (request.method === "POST") {
      if (request.headers.get("Origin") !== url.origin)
        return new Response("Forbidden", { status: 403, headers });
      if (url.pathname === "/logout")
        return redirect(themed("/login"), sessionCookie("", 0));
      if (url.pathname !== "/login")
        return new Response("Not Found", { status: 404, headers });
      const { success } = await env.LOGIN_LIMITER.limit({
        key: request.headers.get("CF-Connecting-IP") || "local",
      });
      if (!success)
        return login(env, "しばらく待ってから、もう一度お試しください。", 429);
      const form = await readForm(request);
      if (!form) return login(env, "入力内容を確認してください。", 400);
      const password = form.get("password");
      if (
        !password ||
        password.length > AUTH.maxPasswordLength ||
        !(await passwordMatches(password, env.DEVELOPER_PASSWORD))
      )
        return login(env, "パスワードが違います。", 401);
      return redirect(themed("/developer"), sessionCookie(await newSession(env)));
    }
    if (request.method !== "GET")
      return new Response("Method Not Allowed", { status: 405, headers });
    if (url.pathname === "/login") return login(env);
    // No private HTML, asset or API is served before this check.
    if (!(await authenticated(request, env))) return redirect(themed("/login"));
    if (env.ASSETS) {
      const assetURL = new URL(request.url);
      if (url.pathname === "/" || url.pathname === "/developer")
        assetURL.pathname = "/index.html";
      const response = await env.ASSETS.fetch(new Request(assetURL, request));
      const secured = new Response(response.body, response);
      secured.headers.set("Cache-Control", "no-store");
      secured.headers.set(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: ${new URL(publicURL(env)).origin}; media-src 'self' blob:; connect-src 'self' blob:; worker-src 'self' blob:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
      );
      secured.headers.set("X-Content-Type-Options", "nosniff");
      secured.headers.set("Referrer-Policy", "same-origin");
      return secured;
    }
    if (url.pathname === "/" || url.pathname === "/developer")
      return pageResponse(env, '<main class="blank" aria-label="開発者用ページ"></main>', 200, true);
    return new Response("Not Found", { status: 404, headers });
  },
};
