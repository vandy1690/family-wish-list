// Setup check. Says which pieces are configured, never their values, and never touches
// storage. "storage": true means the setting exists, not that saving works.
import { json } from '../http.js';
import { isConfigured } from '../auth.js';
import { storageConfigured } from '../store.js';
import { mailConfigured } from '../mail.js';

export async function GET() {
  return json({
    app: 'ok',
    secret: isConfigured(),
    storage: storageConfigured(),
    mail: mailConfigured(),
    admin: Boolean(process.env.LISTS_ADMIN_EMAIL)
  });
}
