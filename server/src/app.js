// Builds the Express app. Kept separate from server.js so tests can import the
// app without opening a port or a database connection.
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { contract } from './config/contract.js';
import { isDbReady } from './config/db.js';
import { notFound, errorHandler } from './middleware/errorMiddleware.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  if (!env.isTest) app.use(morgan(env.isProduction ? 'combined' : 'dev'));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      db: isDbReady() ? 'connected' : 'disconnected',
      contractVersion: contract.version,
    });
  });

  // Exposes the shared enums so the client can build dropdowns and labels
  // without keeping its own copy.
  app.get('/api/meta', (_req, res) => {
    const { roles, categories, priorities, statuses, statusTransitions } = contract;
    res.json({ roles, categories, priorities, statuses, statusTransitions });
  });

  // Feature routers are mounted here as each branch lands:
  //   app.use('/api/auth', authRoutes);        feature/backend-auth
  //   app.use('/api/tickets', ticketRoutes);   feature/backend-tickets
  //   app.use('/api/users', userRoutes);
  //   app.use('/api/manager', managerRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
