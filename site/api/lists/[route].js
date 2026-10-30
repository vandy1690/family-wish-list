// Every /api/lists/<route> address, served by this one function.
//
// Vercel's free plan allows 12 functions per deployment, and the family site also carries
// Family Shifts (4) and MsMadeline (1). Seven separate wish list files pushed it over, so
// they live in lib/lists/routes/ and this file hands each request to the right one.
import * as config from '../../lib/lists/routes/config.js';
import * as data from '../../lib/lists/routes/data.js';
import * as health from '../../lib/lists/routes/health.js';
import * as login from '../../lib/lists/routes/login.js';
import * as logout from '../../lib/lists/routes/logout.js';
import * as lookup from '../../lib/lists/routes/lookup.js';
import * as photo from '../../lib/lists/routes/photo.js';
import * as joinRequest from '../../lib/lists/routes/request.js';
import * as verify from '../../lib/lists/routes/verify.js';

const ROUTES = { config, data, health, login, logout, lookup, photo, request: joinRequest, verify };

function handle(method) {
  return request => {
    const name = new URL(request.url).pathname.replace(/\/+$/, '').split('/').pop();
    const route = Object.hasOwn(ROUTES, name) ? ROUTES[name] : null;
    if (!route) return new Response('Not found', { status: 404 });
    if (!route[method]) return new Response('Method not allowed', { status: 405 });
    return route[method](request);
  };
}

export const GET = handle('GET');
export const POST = handle('POST');
