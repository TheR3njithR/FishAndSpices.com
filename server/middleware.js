import { randomUUID } from 'node:crypto';
import { safeEqualOrigin } from './security.js';

export function requestContext(request, response, next) {
  request.requestId = request.get('x-request-id') || randomUUID();
  response.set('x-request-id', request.requestId);
  const startedAt = performance.now();
  response.on('finish', () => {
    console.log(JSON.stringify({
      level: response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warn' : 'info',
      event: 'http_request',
      requestId: request.requestId,
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs: Math.round(performance.now() - startedAt)
    }));
  });
  next();
}

export function requireSameOrigin(config) {
  return (request, response, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
    if (!safeEqualOrigin(request.get('origin'), config.appOrigin)) {
      return response.status(403).json({ success: false, error: 'Origin not allowed.' });
    }
    next();
  };
}

export function notFound(request, response) {
  if (request.path.startsWith('/api/')) return response.status(404).json({ success: false, error: 'Endpoint not found.' });
  response.status(404).sendFile('404.html', { root: process.cwd() });
}

export function errorHandler(config) {
  return (error, request, response, _next) => {
    console.error(JSON.stringify({
      level: 'error',
      event: 'request_error',
      requestId: request.requestId,
      name: error.name,
      message: error.message
    }));
    if (response.headersSent) return;
    const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 500;
    response.status(status).json({
      success: false,
      error: status >= 500 ? 'The request could not be completed.' : error.message,
      requestId: request.requestId,
      ...(config.isProduction ? {} : { type: error.name })
    });
  };
}
