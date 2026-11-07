/**
 * Auth from environment config. Secrets come from .env or env vars, never JSON config files.
 *
 *   none                        -> no header
 *   bearer                      -> Authorization: Bearer $<tokenEnv|API_TOKEN>
 *   basic                       -> Authorization: Basic base64($<userEnv>:$<passwordEnv>)
 *   apiKey                      -> <headerName|x-api-key>: $<keyEnv|API_KEY>
 *   oauth2_client_credentials   -> token fetched once in setup() and shared with all VUs
 */
import http from 'k6/http';
import encoding from 'k6/encoding';
import { getEnv } from './env.js';

function requireEnv(name) {
  const v = getEnv(name);
  if (!v) throw new Error(`[auth] missing ${name}. Add it to .env or pass -e ${name}=...`);
  return v;
}

export function staticAuthHeaders(auth) {
  switch (auth.type) {
    case undefined:
    case 'none':
    case 'oauth2_client_credentials':
      return {};
    case 'bearer':
      return { Authorization: `Bearer ${requireEnv(auth.tokenEnv || 'API_TOKEN')}` };
    case 'basic': {
      const user = requireEnv(auth.userEnv || 'API_USER');
      const pass = requireEnv(auth.passwordEnv || 'API_PASSWORD');
      return { Authorization: `Basic ${encoding.b64encode(`${user}:${pass}`)}` };
    }
    case 'apiKey':
      return { [auth.headerName || 'x-api-key']: requireEnv(auth.keyEnv || 'API_KEY') };
    default:
      throw new Error(`[auth] unknown auth type "${auth.type}"`);
  }
}

/** Call from setup(): returns an access token or throws. */
export function fetchOAuthToken(auth) {
  const res = http.post(
    auth.tokenUrl,
    {
      grant_type: 'client_credentials',
      client_id: requireEnv(auth.clientIdEnv || 'CLIENT_ID'),
      client_secret: requireEnv(auth.clientSecretEnv || 'CLIENT_SECRET'),
      ...(auth.scope ? { scope: auth.scope } : {}),
    },
    { tags: { name: 'oauth_token', endpoint: 'setup' } }
  );
  if (res.status !== 200) throw new Error(`[auth] token request failed: HTTP ${res.status}`);
  const token = res.json('access_token');
  if (!token) throw new Error('[auth] token response has no access_token');
  return token;
}
