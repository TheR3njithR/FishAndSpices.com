import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { errorHandler, notFound, requestContext, requireSameOrigin } from './middleware.js';
import { createApiRouter } from './routes/api.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cleanRoutes = new Map([
  ['/buy', 'buy.html'], ['/sell', 'sell.html'], ['/fish', 'fish.html'], ['/spices', 'spices.html'],
  ['/how-it-works', 'how-it-works.html'], ['/safety', 'safety.html'], ['/contact', 'contact.html'],
  ['/privacy', 'privacy.html'], ['/terms', 'terms.html'], ['/thank-you', 'thank-you.html'], ['/account', 'account.html'], ['/assistant', 'assistant.html']
]);

export function createApp({ config, pool, services = {} }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(requestContext);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://challenges.cloudflare.com'],
        frameSrc: ['https://challenges.cloudflare.com'],
        connectSrc: ["'self'", 'https://challenges.cloudflare.com'],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"]
      }
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  }));
  app.use(compression());
  app.use(cookieParser());
  app.use('/api', express.json({ limit: '48kb', strict: true, type: 'application/json' }));
  app.use('/api', requireSameOrigin(config));
  app.use('/api', createApiRouter({ config, pool, services }));
  for (const [route, file] of cleanRoutes) app.get(route, (_request, response) => response.sendFile(file, { root }));
  app.get('/admin', (_request, response) => response.sendFile('admin/index.html', { root }));
  app.get('/admin/marketing-ai', (_request, response) => response.sendFile('admin/marketing-ai.html', { root }));
  app.use(express.static(root, { extensions: ['html'], index: 'index.html', maxAge: config.isProduction ? '1h' : 0 }));
  app.use(notFound);
  app.use(errorHandler(config));
  return app;
}
