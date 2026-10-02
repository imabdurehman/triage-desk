// The only file that reads process.env. Everything else imports `env` from here.
import "dotenv/config";

const isTest = process.env.NODE_ENV === "test";
const required = ["MONGO_URI", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];

if (!isTest) {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    // Fail at boot, loudly, rather than at the first request.
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Set them in server/.env (copy .env.example first); the README shows how to generate the secrets.",
    );
  }
  if (process.env.JWT_ACCESS_SECRET === process.env.JWT_REFRESH_SECRET) {
    // Same secret for both would let a refresh token pass as an access token.
    throw new Error(
      "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different",
    );
  }
}

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  isTest,
  port: Number(process.env.PORT ?? 5000),
  mongoUri: process.env.MONGO_URI ?? "",
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  mlServiceUrl: (process.env.ML_SERVICE_URL ?? "http://localhost:8000").replace(
    /\/+$/,
    "",
  ),
  // `||`, not `??`: an empty value copied from .env.example must count as missing.
  jwtAccessSecret:
    process.env.JWT_ACCESS_SECRET || (isTest ? "test-access-secret" : ""),
  jwtRefreshSecret:
    process.env.JWT_REFRESH_SECRET || (isTest ? "test-refresh-secret" : ""),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? "15m",
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7),
  enableScheduler:
    (process.env.ENABLE_SCHEDULER ?? "true") !== "false" && !isTest,
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  staleWaitingDays: Number(process.env.STALE_WAITING_DAYS ?? 7),
  autoCloseResolvedDays: Number(process.env.AUTO_CLOSE_RESOLVED_DAYS ?? 3),
  maxOpenTickets: Number(process.env.MAX_OPEN_TICKETS ?? 15),
  smtpUrl: process.env.SMTP_URL ?? "",
  mailFrom: process.env.MAIL_FROM ?? "TriageDesk <no-reply@triagedesk.local>",
});
