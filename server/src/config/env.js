// The only file that reads process.env. Everything else imports `env` from here.
import 'dotenv/config';

const required = ['MONGO_URI'];
const isTest = process.env.NODE_ENV === 'test';

if (!isTest) {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    // Fail at boot, loudly, rather than at the first request.
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isTest,
  port: Number(process.env.PORT ?? 5000),
  mongoUri: process.env.MONGO_URI ?? '',
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  mlServiceUrl: (process.env.ML_SERVICE_URL ?? 'http://localhost:8000').replace(/\/+$/, ''),
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? '',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
});
