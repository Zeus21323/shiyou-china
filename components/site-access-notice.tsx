'use client';
import { useEffect, useState } from 'react';
import {
  SITE_ACCESS_EVENT,
  SITE_SIGN_IN,
  type AccessProblem,
} from '../lib/site-data';

export default function SiteAccessNotice({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  const [problem, setProblem] = useState<AccessProblem | null>(null);
  const [hosted, setHosted] = useState(false);
  useEffect(() => {
    const isHosted = window.location.hostname.endsWith('.chatgpt.site');
    setHosted(isHosted);
    const onAccess = (event: Event) =>
      isHosted && setProblem((event as CustomEvent<AccessProblem>).detail);
    window.addEventListener(SITE_ACCESS_EVENT, onAccess);
    return () => window.removeEventListener(SITE_ACCESS_EVENT, onAccess);
  }, []);
  if (!problem && !error) return null;
  return (
    <div className="map-error site-access-notice" role="alert">
      <span>
        {problem === 'login'
          ? '登录状态已失效，地图与诗文需要重新登录后读取。'
          : problem === 'forbidden'
            ? '此页面仅站点所属账号可访问，请确认登录账号。'
            : error}
      </span>
      <div className="site-access-actions">
        {!problem && <button onClick={onRetry}>重试加载</button>}
        {hosted && (
          <a href={SITE_SIGN_IN}>
            {problem ? '使用 ChatGPT 重新登录' : '重新验证登录'}
          </a>
        )}
      </div>
    </div>
  );
}
