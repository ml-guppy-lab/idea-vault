import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api",
  headers: { "Content-Type": "application/json" },
});

// ── Token refresh interceptor ─────────────────────────────────────────────────
//
// When any API call returns 401 (access token expired), we:
//   1. Call /api/auth/refresh once — it reads the httpOnly refresh cookie
//      and sets a new access_token cookie.
//   2. Retry the original request (cookies are sent automatically).
//   3. If the refresh itself fails (refresh token also expired/revoked),
//      redirect to /login.
//
// Lock + queue: if multiple requests all 401 at the same time, only ONE
// refresh call fires. All others wait for it and then retry together.

let isRefreshing = false;
let refreshQueue: Array<(ok: boolean) => void> = [];

function resolveQueue(ok: boolean) {
  refreshQueue.forEach((fn) => fn(ok));
  refreshQueue = [];
}

api.interceptors.response.use(
  (res) => res, // pass successful responses straight through

  async (error) => {
    const original = error.config;

    // Only handle 401s that haven't already been retried
    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      // Another refresh is already in flight — queue this request
      return new Promise((resolve, reject) => {
        refreshQueue.push((ok) => {
          if (ok) {
            original._retry = true;
            resolve(api(original));
          } else {
            reject(error);
          }
        });
      });
    }

    original._retry = true;
    isRefreshing = true;

    try {
      const refreshRes = await fetch("/api/auth/refresh", { method: "POST" });
      if (!refreshRes.ok) throw new Error("refresh failed");

      resolveQueue(true);
      return api(original); // retry the original request with new cookie
    } catch {
      resolveQueue(false);
      // Both tokens are dead — force the user back to login
      if (typeof window !== "undefined") {
        window.location.href = "/login?error=session_expired";
      }
      return Promise.reject(error);
    } finally {
      isRefreshing = false;
    }
  }
);

export default api;
