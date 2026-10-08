// Builds the Express app. Kept separate from server.js so tests can import the
// app without opening a port or a database connection.
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { contract } from "./config/contract.js";
import { isDbReady } from "./config/db.js";
import { notFound, errorHandler } from "./middleware/errorMiddleware.js";
import authRoutes from "./routes/authRoutes.js";
import ticketRoutes from "./routes/ticketRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import managerRoutes from "./routes/managerRoutes.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1); // correct client IP behind a proxy, needed by the rate limiter
  app.use(helmet());
  app.use(cors({ origin: env.clientOrigin, credentials: true })); // credentials: send the cookie
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  if (!env.isTest) app.use(morgan(env.isProduction ? "combined" : "dev"));

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      db: isDbReady() ? "connected" : "disconnected",
      contractVersion: contract.version,
    });
  });

  // Serves the shared enums so the client never keeps its own copy.
  app.get("/api/meta", (_req, res) => {
    const {
      roles,
      categories,
      priorities,
      statuses,
      statusTransitions,
      slaHours,
    } = contract;
    res.json({
      roles,
      categories,
      priorities,
      statuses,
      statusTransitions,
      slaHours,
    });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/tickets", ticketRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/manager", managerRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
