/**
 * Axios instance pre-configured for the Idea Vault FastAPI backend.
 *
 * Base URL is read from NEXT_PUBLIC_API_URL (.env.local).
 * All auth endpoints that need a JWT pass the token in the
 * Authorization header — callers can set it per-request or via
 * a higher-level interceptor added in a future step.
 */

import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api",
  headers: {
    "Content-Type": "application/json",
  },
});

export default api;
