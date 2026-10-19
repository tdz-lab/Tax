import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
import { getDb } from './db/schema';
import { ensureSeeded, requestPersistentStorage } from './services/bootstrap';
import { registerServiceWorker } from './pwa';
import { getSetting } from './services/settings';
import { registerImportedRuleSets, type TaxRuleSet } from './engines/tax/rules';

async function start() {
  const root = createRoot(document.getElementById('root')!);
  try {
    await getDb().open();
    await ensureSeeded();
    registerImportedRuleSets(await getSetting<TaxRuleSet[]>('importedRuleSets', []));
    void requestPersistentStorage();
  } catch (e) {
    root.render(
      <div style={{ padding: 20, fontFamily: 'system-ui' }}>
        <h1>Local database unavailable</h1>
        <p>{(e as Error).message}</p>
        <p>This application stores data in your browser (IndexedDB). Private/incognito windows or blocked site data can prevent it from opening.</p>
      </div>
    );
    return;
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
  registerServiceWorker();
}
void start();
