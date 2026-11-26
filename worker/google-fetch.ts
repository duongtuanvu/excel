// Cloudflare workerd accepts manual/follow, not the Fetch API's error mode.
// Never follow an OAuth redirect: its body or Authorization header is sensitive.
export type GoogleEndpoint = 'token' | 'userinfo';
const URLS: Record<GoogleEndpoint, string> = {
  token: 'https://oauth2.googleapis.com/token',
  userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
};
export async function googleFetch(endpoint: GoogleEndpoint, init: RequestInit, request: typeof fetch = fetch): Promise<Response> {
  return request(URLS[endpoint], {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
}
export function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}
export function networkFailure(error: unknown): 'timeout' | 'network' {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'network';
}
