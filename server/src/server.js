import { createApp } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { env } from './config/env.js';

async function start() {
  await connectDB();
  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port}  (${env.nodeEnv})`);
  });

  // Close cleanly so in-flight requests finish and Mongo is released.
  const shutdown = (signal) => {
    console.log(`[server] ${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('[server] failed to start:', err.message);
  process.exit(1);
});
