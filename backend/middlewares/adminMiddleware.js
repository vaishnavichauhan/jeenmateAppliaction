/**
 * adminMiddleware – must be used AFTER authMiddleware.
 * Allows the request only if the authenticated user has role 'admin'.
 */
function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin privileges required.',
    });
  }
  next();
}

module.exports = adminMiddleware;
