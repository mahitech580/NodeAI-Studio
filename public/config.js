/* Optional cross-origin API configuration.
 * Same-origin Express deployments can leave apiBaseUrl empty.
 * For static hosting, set this to the HTTPS origin of your deployed NodeAI API.
 * Example: window.NODEAI_CONFIG = { apiBaseUrl: 'https://your-node-service.example' };
 */
window.NODEAI_CONFIG = Object.assign({ apiBaseUrl: '' }, window.NODEAI_CONFIG || {});
