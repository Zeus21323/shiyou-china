/** 私有站点的数据请求：先检查身份验证和响应类型，再交给 JSON/地形解析器。 */
export const SITE_SIGN_IN = '/signin-with-chatgpt?return_to=%2F';
export const SITE_ACCESS_EVENT = 'site-data-access-required';
export type AccessProblem = 'login' | 'forbidden';

export class SiteDataError extends Error {
  readonly kind: AccessProblem | 'response';
  constructor(kind: AccessProblem | 'response', message: string) {
    super(message);
    this.name = 'SiteDataError';
    this.kind = kind;
  }
}

function fail(kind: SiteDataError['kind'], url: string, status: number): never {
  // 不记录登录页面、Cookie、完整重定向 URL 或任何凭据。
  console.warn('[site-data]', url.split('?')[0], status, kind);
  if (kind !== 'response' && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SITE_ACCESS_EVENT, { detail: kind }));
  }
  throw new SiteDataError(
    kind,
    kind === 'login'
      ? '登录状态已失效，请重新登录后继续。'
      : kind === 'forbidden'
        ? '当前账号无法读取此私有站点，请使用站点所属账号登录。'
        : '数据暂时无法读取，请重试。',
  );
}

export async function fetchSiteData(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(url, { ...init, credentials: 'same-origin' });
  if (response.status === 401) fail('login', url, response.status);
  if (response.status === 403) fail('forbidden', url, response.status);
  // Sites 的登录入口可能返回 HTTP 200 的 HTML，不能把它当成损坏的数据。
  const loginRedirect =
    response.redirected &&
    /\/(?:signin-with-chatgpt|log-in|login)(?:[/?#]|$)/.test(response.url);
  if (loginRedirect) fail('login', url, response.status);
  if (response.headers.get('content-type')?.includes('text/html')) {
    const html = await response.text();
    const isLogin = /signin-with-chatgpt|auth\.openai\.com\/log-in/.test(html);
    fail(isLogin ? 'login' : 'response', url, response.status);
  }
  if (!response.ok) fail('response', url, response.status);
  return response;
}
