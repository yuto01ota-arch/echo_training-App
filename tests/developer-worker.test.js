import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import worker from "../developer/worker.js";

const origin = "https://developer.example";
function settings() {
  return {
    DEVELOPER_PASSWORD: randomBytes(24).toString("base64url"),
    SESSION_SECRET: randomBytes(32).toString("base64url"),
    PUBLIC_APP_URL: "https://yuto01ota-arch.github.io/echo_training-App/",
    LOGIN_LIMITER: { limit: async () => ({ success: true }) },
  };
}
const request = (path, options = {}) => new Request(origin + path, options);
function post(password, options = {}) {
  return request("/login", {
    method: "POST",
    headers: { Origin: origin, ...options },
    body: new URLSearchParams({ password }),
  });
}
async function signIn(env) {
  const response = await worker.fetch(post(env.DEVELOPER_PASSWORD), env);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/developer");
  return response.headers.get("Set-Cookie").split(";")[0];
}

test("private HTML and direct URLs require a valid server session", async () => {
  const env = settings();
  for (const path of ["/", "/developer", "/private/file.json"]) {
    const response = await worker.fetch(request(path), env);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("Location"), "/login");
    assert.equal(await response.text(), "");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  const response = await worker.fetch(request("/login"), env);
  const html = await response.text();
  assert.match(html, /type="password"/);
  assert.ok(!html.includes(env.DEVELOPER_PASSWORD));
  assert.ok(!html.includes(env.SESSION_SECRET));
  assert.ok(!html.includes('class="blank"'));
  const invalid = await worker.fetch(post("incorrect"), env);
  assert.equal(invalid.status, 401);
  assert.equal(invalid.headers.get("Set-Cookie"), null);
  const cookie = await signIn(env);
  const privatePage = await worker.fetch(
    request("/developer", { headers: { Cookie: cookie } }),
    env,
  );
  assert.equal(privatePage.status, 200);
  assert.match(await privatePage.text(), /class="blank"/);
  assert.equal(privatePage.headers.get("Cache-Control"), "no-store");
  assert.match(
    privatePage.headers.get("Content-Security-Policy"),
    /frame-ancestors 'none'/,
  );
});

test("tampered, expired and password-rotated sessions cannot open the private page", async () => {
  const env = settings();
  const cookie = await signIn(env);
  const token = cookie.split("=")[1];
  const [expires, nonce, signature] = token.split(".");
  for (const bad of [
    "__Host-echo_developer=true",
    `__Host-echo_developer=${expires}.${nonce}.${"0".repeat(64)}`,
    `__Host-echo_developer=1000000000.${nonce}.${signature}`,
    `__Host-echo_developer=${Number(expires) + 99999}.${nonce}.${signature}`,
  ]) {
    assert.equal(
      (
        await worker.fetch(
          request("/developer", { headers: { Cookie: bad } }),
          env,
        )
      ).status,
      303,
    );
  }
  env.DEVELOPER_PASSWORD = randomBytes(24).toString("base64url");
  assert.equal(
    (
      await worker.fetch(
        request("/developer", { headers: { Cookie: cookie } }),
        env,
      )
    ).status,
    303,
  );
});

test("login limits, origin checks, bounded inputs and missing secrets fail closed", async () => {
  const env = settings();
  assert.equal(
    (
      await worker.fetch(
        post(env.DEVELOPER_PASSWORD, { Origin: "https://other.example" }),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await worker.fetch(
        request("/login", {
          method: "POST",
          body: new URLSearchParams({ password: env.DEVELOPER_PASSWORD }),
        }),
        env,
      )
    ).status,
    403,
  );
  assert.equal((await worker.fetch(post("a".repeat(5000)), env)).status, 400);
  assert.equal(
    (
      await worker.fetch(
        request("/login", {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: "{}",
        }),
        env,
      )
    ).status,
    400,
  );
  env.LOGIN_LIMITER = { limit: async () => ({ success: false }) };
  assert.equal(
    (await worker.fetch(post(env.DEVELOPER_PASSWORD), env)).status,
    429,
  );
  for (const missing of [
    "DEVELOPER_PASSWORD",
    "SESSION_SECRET",
    "LOGIN_LIMITER",
  ]) {
    const config = settings();
    delete config[missing];
    const response = await worker.fetch(request("/developer"), config);
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('class="blank"'));
  }
});

test("sessions use secure HTTP-only cookies and logout clears the browser cookie", async () => {
  const env = settings();
  const response = await worker.fetch(post(env.DEVELOPER_PASSWORD), env);
  const cookie = response.headers.get("Set-Cookie");
  for (const value of [
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=14400",
  ])
    assert.ok(cookie.includes(value));
  const logout = await worker.fetch(
    request("/logout", {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie.split(";")[0] },
    }),
    env,
  );
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get("Set-Cookie"), /Max-Age=0/);
});

test("theme redirects allow only display modes and login scripts require a fresh nonce", async () => {
  const env = settings();
  for (const [query, expected] of [["dark", "/login?theme=dark"], ["light", "/login?theme=light"], ["invalid", "/login"]]) {
    const response = await worker.fetch(request(`/?theme=${query}`), env);
    assert.equal(response.headers.get("Location"), expected);
  }
  const login = await worker.fetch(request("/login?theme=dark"), env);
  const html = await login.text();
  const nonce = html.match(/<script type="module" nonce="([a-f0-9]+)">/)[1];
  const csp = login.headers.get("Content-Security-Policy");
  assert.ok(csp.includes(`script-src 'self' 'nonce-${nonce}'`));
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp));
  const next = await worker.fetch(request("/login"), env);
  assert.ok(!(await next.text()).includes(`nonce="${nonce}"`));
  const signedIn = await worker.fetch(request("/login?theme=dark", {
    method: "POST", headers: { Origin: origin },
    body: new URLSearchParams({ password: env.DEVELOPER_PASSWORD }),
  }), env);
  assert.equal(signedIn.headers.get("Location"), "/developer?theme=dark");
});

test("only shared theme assets are available before editor authentication", async () => {
  const env = settings();
  const served = [];
  env.ASSETS = { fetch: async request => {
    served.push(new URL(request.url).pathname);
    return new Response("shared theme asset");
  } };
  for (const path of ["/theme.js", "/theme.css"]) {
    const response = await worker.fetch(request(path), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  for (const path of ["/index.html", "/assets/editor.js", "/models/male.glb", "/theme.js/private"]) {
    assert.equal((await worker.fetch(request(path), env)).status, 303);
  }
  assert.deepEqual(served, ["/theme.js", "/theme.css"]);
});
