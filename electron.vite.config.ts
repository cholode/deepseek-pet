import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ main: {}, preload: {}, renderer: { plugins: [react(), { name: 'development-csp', transformIndexHtml: { order: 'post', handler(html, context) { return context.server ? html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace("connect-src 'self' petasset:", "connect-src 'self' petasset: ws://localhost:* http://localhost:*") : html; } } }] } });
