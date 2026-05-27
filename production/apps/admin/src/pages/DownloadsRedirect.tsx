/**
 * Downloads-sidebar shim. AdminJS's pages registry needs a React
 * component, but the actual Downloads page is a static HTML response
 * rendered by the Fastify onRequest hook at /admin/downloads (outside
 * AdminJS). This component just bounces the browser there with a
 * window.location.assign() — a real browser navigation, not the SPA
 * router push that would otherwise hit AdminJS's catch-all and 404.
 */
import React, { useEffect } from 'react';

export default function DownloadsRedirect(): React.ReactElement {
  useEffect(() => {
    window.location.assign('/admin/downloads');
  }, []);
  return (
    <div
      style={{
        padding: '48px 24px',
        textAlign: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
      }}
    >
      <p style={{ color: '#6F7E70', fontSize: 15 }}>
        Opening the downloads centre…{' '}
        <a
          href="/admin/downloads"
          style={{ color: '#A86A2B', textDecoration: 'underline' }}
        >
          Click here if you’re not redirected.
        </a>
      </p>
    </div>
  );
}
