// The only place the server talks to the Python ML service.
// predict() NEVER throws: ticket creation must survive the ML service being down.
import { env } from "../config/env.js";
import { CATEGORIES, PRIORITIES, ML_CONFIG } from "../config/contract.js";
import { ApiError } from "../utils/ApiError.js";

async function call(path, { method = "GET", body, timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // globalThis.fetch is read at call time so tests can replace it.
    const res = await globalThis.fetch(`${env.mlServiceUrl}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(
        data?.error?.message ?? `ML service responded ${res.status}`,
      );
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === "AbortError")
      throw new Error(`ML service timed out after ${timeoutMs} ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const fallback = (reason) => ({
  ok: false,
  category: ML_CONFIG.fallback.category,
  priority: ML_CONFIG.fallback.priority,
  confidence: { category: 0, priority: 0 },
  modelVersion: null,
  reason,
});

export async function predict({ subject, body }) {
  try {
    const r = await call("/predict", {
      method: "POST",
      body: { subject, body },
      timeoutMs: ML_CONFIG.predictTimeoutMs,
    });
    // Defend the database: never store a label the contract doesn't know.
    if (
      !CATEGORIES.includes(r?.category) ||
      !PRIORITIES.includes(r?.priority)
    ) {
      return fallback("ML returned a label outside the contract");
    }
    return {
      ok: true,
      category: r.category,
      priority: r.priority,
      confidence: {
        category: Number(r.confidence?.category ?? 0),
        priority: Number(r.confidence?.priority ?? 0),
      },
      modelVersion: r.modelVersion ?? null,
    };
  } catch (err) {
    if (!env.isTest)
      console.warn(`[ml] predict failed, using fallback: ${err.message}`);
    return fallback(err.message);
  }
}

/** True when the prediction is good enough to route without a human. */
export const isConfident = (p) =>
  p.ok && p.confidence.category >= ML_CONFIG.minConfidenceForAutoRoute;

export async function health() {
  try {
    return { reachable: true, ...(await call("/health", { timeoutMs: 3000 })) };
  } catch (err) {
    return { reachable: false, error: err.message };
  }
}

// Management calls DO surface errors: a manager asked for them explicitly.
/** Starts a training run on the ML service with the given human-confirmed tickets. */
export async function train(tickets) {
  try {
    return await call("/train", {
      method: "POST",
      body: { tickets },
      timeoutMs: 30_000,
    });
  } catch (err) {
    throw new ApiError(
      502,
      "ML_UNAVAILABLE",
      `Could not start training: ${err.message}`,
    );
  }
}

/** The live model's metrics, or null when no model has been promoted yet. */
export async function metrics() {
  try {
    return await call("/metrics", { timeoutMs: 5000 });
  } catch (err) {
    if (err.status === 404) return null;
    throw new ApiError(
      502,
      "ML_UNAVAILABLE",
      `Could not read model metrics: ${err.message}`,
    );
  }
}

export async function runStatus(runId) {
  try {
    return await call(`/train/${encodeURIComponent(runId)}`, {
      timeoutMs: 5000,
    });
  } catch (err) {
    throw new ApiError(502, "ML_UNAVAILABLE", err.message);
  }
}
