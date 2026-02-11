function errorHandler(err, req, res, _next) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  if (res.headersSent) return;
  const status = err.status || 500;
  // Never leak internal error details in production
  const message = status < 500 ? (err.message || 'Request error') : 'Internal server error';
  res.status(status).json({ error: message });
}

module.exports = errorHandler;
