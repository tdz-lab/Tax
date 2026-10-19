/**
 * Interactive tutorial definitions.
 *
 * Targets are small expressions resolved against the live page (see resolve.ts):
 *   'nav:Label'      main navigation link          'tab:Label'     a tab
 *   'button:Text'    button / button-styled link     'label:Text'    a form field (label → field wrapper)
 *   'panel:Heading'  panel with that heading         'stat:Label'    dashboard-style stat tile
 *   'col:Header'     table column header             'text:Text'     any element with that text
 *   'dialog'         the open dialog                 any CSS selector ('[aria-label="…"]', '.toolbar', …)
 */
export type Target = string;

export type TourAction =
  | { route: string }
  | { click: Target }
  | { select: [Target, string] }
  | { fill: [Target, string] }
  | { closeDialogs: true }
  | { wait: number };

export interface TryIt {
  /** Instruction shown while waiting, e.g. “Click + New record”. */
  hint: string;
  /** Returns true once the user has done it. Polled twice a second. */
  check: (ctx: TourCtx) => boolean | Promise<boolean>;
}

export interface TourStep {
  title: string;
  /** Paragraphs separated by blank lines; lines starting with "- " become bullets; **bold** supported. */
  body: string;
  /** Navigate here before showing the step (dialogs are closed first). */
  route?: string;
  /** Element to spotlight. Omit for a centred explanation card. */
  target?: Target;
  /** Run before the step is shown (open a dialog, choose a tab, reveal fields…). */
  before?: TourAction[];
  /** Interactive step: the Next button unlocks once the check passes (or the user skips). */
  tryIt?: TryIt;
}

export interface Tour {
  id: string;
  section: string; // route of the section the tour belongs to, e.g. '/trading'
  title: string;
  summary: string;
  minutes: number;
  /** Works best with practice (demonstration) data loaded. */
  needsData?: boolean;
  steps: TourStep[];
}

export interface TourCtx {
  startedAt: string;
  find: (t: Target) => HTMLElement | null;
  dialogOpen: () => boolean;
  countCreatedSince: (filter?: (t: import('../../domain/types').Transaction) => boolean) => Promise<number>;
}
