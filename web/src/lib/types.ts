export const MED_COLORS = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red', 'teal', 'indigo', 'coral', 'lime', 'brown', 'gray'] as const;
/** One of the named colors, or a color of the user's own as "#rrggbb". */
export type MedColor = (typeof MED_COLORS)[number] | `#${string}`;

export const isCustomColor = (color: string): color is `#${string}` => /^#[0-9a-f]{6}$/i.test(color);

/** The CSS value to paint a medicine's color with. Named colors have a light and a dark shade; a custom one is used as is. */
export const cssColor = (color: string) => (isCustomColor(color) ? color : `var(--med-${color})`);

export const MED_FORMS = ['tablet', 'capsule', 'liquid', 'injection', 'inhaler', 'drops', 'cream', 'patch', 'other'] as const;
export type MedForm = (typeof MED_FORMS)[number];

/** What the little picture of the medicine looks like. */
export const MED_ICONS = ['round', 'oval', 'caplet', 'capsule', 'softgel', 'liquid', 'drops', 'syringe', 'inhaler', 'tube', 'patch'] as const;
export type MedIcon = (typeof MED_ICONS)[number];

/** Another dose of the same medicine, due a set time after the dose before it was taken. */
export interface FollowUp {
  afterMinutes: number;
  qty: number;
}

export interface Schedule {
  id: string;
  /** Local wall-clock time, "HH:MM". */
  time: string;
  qty: number;
  /** Days of the week it applies to, as digits 0 (Sunday) – 6 (Saturday). */
  days: string;
  startDate: string;
  endDate: string | null;
  /** Later doses that follow this one, each timed from when the one before was taken. */
  followUps?: FollowUp[];
}

export interface Med {
  id: string;
  name: string;
  strength: string;
  form: MedForm;
  color: MedColor;
  /** Empty or missing means "pick one that suits the form". */
  icon?: MedIcon | '';
  instructions: string;
  prescriber: string;
  pharmacy: string;
  rxNumber: string;
  /** Units on hand; null when the supply isn't being counted. */
  stock: number | null;
  /** Warn when this many days of supply (or fewer) are left. */
  lowDays: number;
  refillsLeft: number | null;
  asNeeded: boolean;
  archivedAt: string | null;
  createdAt?: string;
  schedules: Schedule[];
}

export interface Dose {
  id: string;
  medId: string;
  scheduleId: string | null;
  date: string;
  time: string;
  status: 'taken' | 'skipped';
  qty: number;
  takenAt: string | null;
}

export interface Refill {
  id: string;
  medId: string;
  date: string;
  qty: number;
  note: string;
}

/** A journal question the user added, or a built-in one they switched off (same id, archived). */
export interface JournalQuestion {
  id: string;
  text: string;
  archived: boolean;
}

/** One day's journal: each answer is 1 (lowest) to 5 (highest), keyed by question id. */
export interface JournalEntry {
  date: string;
  answers: Record<string, number>;
  note: string;
}

export interface AppState {
  meds: Med[];
  doses: Dose[];
  refills: Refill[];
  questions: JournalQuestion[];
  journal: JournalEntry[];
}

export type Op =
  | { type: 'med.put'; med: Med }
  | { type: 'med.delete'; id: string }
  | { type: 'stock.set'; medId: string; stock: number | null }
  | { type: 'dose.put'; dose: Dose }
  | { type: 'dose.delete'; id: string }
  | { type: 'refill.add'; refill: Refill; useRefill: boolean }
  | { type: 'question.put'; question: JournalQuestion }
  | { type: 'journal.put'; entry: JournalEntry };

export const EMPTY_STATE: AppState = { meds: [], doses: [], refills: [], questions: [], journal: [] };
