/** Resolves tutorial target expressions against the live DOM. */
import type { Target } from './types';

/** Application dialogs (excluding the tutorial's own cards). */
export const APP_DIALOG = '[role="dialog"]:not(.tour-card):not(.tour-modal)';

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').replace(/\s*\*$/, '').trim().toLowerCase();

function visible(el: Element): boolean {
  const r = (el as HTMLElement).getBoundingClientRect?.();
  if (!r || (r.width === 0 && r.height === 0)) return false;
  const st = getComputedStyle(el as HTMLElement);
  return st.visibility !== 'hidden' && st.display !== 'none';
}

/** Best text match: exact, then starts-with, then contains (shortest text wins). */
function byText(root: ParentNode, selector: string, text: string): HTMLElement | null {
  const want = norm(text);
  const els = [...root.querySelectorAll<HTMLElement>(selector)].filter((e) => visible(e) && !e.closest('.tour-card'));
  const scored = els
    .map((e) => ({ e, t: norm(e.textContent) }))
    .filter((x) => x.t.includes(want))
    .sort((a, b) => {
      const rank = (x: { t: string }) => (x.t === want ? 0 : x.t.startsWith(want) ? 1 : 2);
      return rank(a) - rank(b) || a.t.length - b.t.length;
    });
  return scored[0]?.e ?? null;
}

function scopes(): ParentNode[] {
  const dialogs = [...document.querySelectorAll(APP_DIALOG)].filter(visible);
  return dialogs.length ? [dialogs[dialogs.length - 1], document] : [document];
}

export function resolveTarget(t: Target): HTMLElement | null {
  if (t === 'dialog') {
    const d = [...document.querySelectorAll<HTMLElement>(APP_DIALOG)].filter(visible);
    return d[d.length - 1] ?? null;
  }
  const m = /^(nav|tab|button|label|panel|stat|col|text|css):/.exec(t);
  const kind = m ? m[1] : 'css';
  const arg = m ? t.slice(m[0].length) : t;
  for (const root of scopes()) {
    let el: HTMLElement | null = null;
    switch (kind) {
      case 'nav':
        el = byText(root, 'nav[aria-label="Main navigation"] a', arg);
        break;
      case 'tab':
        el = byText(root, '[role="tab"]', arg);
        break;
      case 'button':
        el = byText(root, 'button, a.btn, label.btn', arg);
        break;
      case 'label': {
        const lab = byText(root, 'label, .lbl, legend', arg);
        el = (lab?.closest('.field, fieldset') as HTMLElement) ?? lab;
        break;
      }
      case 'panel': {
        const h = byText(root, 'h2, h3', arg);
        el = (h?.closest('.panel, .modal') as HTMLElement) ?? h;
        break;
      }
      case 'stat': {
        const l = byText(root, '.stat .label', arg);
        el = (l?.closest('.stat') as HTMLElement) ?? null;
        break;
      }
      case 'col':
        el = byText(root, 'th', arg);
        break;
      case 'text':
        el = byText(root, 'h1, h2, h3, p, span, div, td, li, b, a, button, label, legend, summary', arg);
        break;
      default:
        try {
          el = [...root.querySelectorAll<HTMLElement>(arg)].find((e) => visible(e) && !e.closest('.tour-card')) ?? null;
        } catch {
          el = null;
        }
    }
    if (el) return el;
  }
  return null;
}

/** Set a value on a React-controlled input/select so React sees the change. */
export function setControlValue(field: HTMLElement, value: string): boolean {
  const control = (field.matches('input, select, textarea') ? field : field.querySelector('input, select, textarea')) as HTMLInputElement | HTMLSelectElement | null;
  if (!control) return false;
  const proto = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  return true;
}
