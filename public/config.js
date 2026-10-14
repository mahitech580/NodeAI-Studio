/* Optional API origin for static deployments.
 * Leave empty for same-origin Node deployments.
 * Example: window.NODEAI_CONFIG = { apiBaseUrl: 'https://your-api.example.com' };
 */
window.NODEAI_CONFIG = Object.assign({ apiBaseUrl: '' }, window.NODEAI_CONFIG || {});
