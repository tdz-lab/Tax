/** Service-worker registration (offline app shell). Updates are applied on the next load after the user confirms. */
import { registerSW } from 'virtual:pwa-register';

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      if (window.confirm('A new version of the application is available. Reload now? (Your data is stored locally and is not affected.)')) void update(true);
    },
    onOfflineReady() {
      console.info('Application cached for offline use.');
    }
  });
}
