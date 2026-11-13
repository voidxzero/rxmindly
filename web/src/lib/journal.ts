// The daily journal: a few 1-to-5 questions and a note. Pure helpers, no storage.

import type { AppState, JournalEntry } from './types';

export interface Question {
  id: string;
  text: string;
  /** What 1 and 5 mean. */
  low: string;
  high: string;
  builtIn: boolean;
}

/** Every built-in question runs the same way: 5 is the good end, so the charts all read alike. */
export const DEFAULT_QUESTIONS: Question[] = [
  { id: 'mood', text: 'How was your mood today?', low: 'Very low', high: 'Great', builtIn: true },
  { id: 'energy', text: 'How much energy did you have?', low: 'Drained', high: 'Lots', builtIn: true },
  { id: 'sleep', text: 'How well did you sleep last night?', low: 'Badly', high: 'Very well', builtIn: true },
  { id: 'calm', text: 'How calm did you feel?', low: 'Very stressed', high: 'Very calm', builtIn: true },
];

/**
 * Answers are always stored on 1–5 (decimals allowed). The scale the app shows
 * (1–5, 1–10, …) is only how they are asked and drawn, so changing it never
 * changes what was answered.
 */
export const SCALE_SIZES = [5, 10, 15, 20] as const;
export type ScaleSize = (typeof SCALE_SIZES)[number];
/** Numbered buttons (or a stepped slider when there are too many to fit), or a plain slider with no numbers. */
export type ScaleKind = 'numbers' | 'slider';

/** A stored answer (1–5) shown on a 1–max scale. */
export const toScale = (value: number, max: number) => 1 + ((value - 1) * (max - 1)) / 4;
/** An answer given on a 1–max scale, as stored (1–5, three decimals). */
export const fromScale = (n: number, max: number) => Math.round((1 + ((n - 1) * 4) / (max - 1)) * 1000) / 1000;
/** How a stored answer or average is written on the charts: on the chosen scale, to a tenth. */
export const formatScaled = (value: number, max: number) => toScale(value, max).toFixed(1);
/** Labelled lines on a chart's axis: five evenly spaced whole numbers, top one the scale's end. */
export const scaleTicks = (max: number) => [1, 2, 3, 4, 5].map((i) => (i * max) / 5);

/** Built-in questions that haven't been switched off. */
export const defaultIsOn = (state: AppState, id: string) => !state.questions.some((q) => q.id === id && q.archived);

/** The user's own questions that are still in use. */
export const customQuestions = (state: AppState): Question[] =>
  state.questions
    .filter((q) => !q.archived && !DEFAULT_QUESTIONS.some((d) => d.id === q.id))
    .map((q) => ({ id: q.id, text: q.text, low: 'Low', high: 'High', builtIn: false }));

/** The questionnaire as it stands today: built-in questions first, then the user's own. */
export const activeQuestions = (state: AppState): Question[] => [...DEFAULT_QUESTIONS.filter((q) => defaultIsOn(state, q.id)), ...customQuestions(state)];

export const entryFor = (state: AppState, date: string): JournalEntry => state.journal.find((e) => e.date === date) ?? { date, answers: {}, note: '' };

export interface Trend {
  question: Question;
  /** One value per date, null where the question wasn't answered. */
  values: (number | null)[];
  answered: number;
  average: number | null;
}

export function journalTrends(state: AppState, dates: string[]): Trend[] {
  const byDate = new Map(state.journal.map((e) => [e.date, e]));
  return activeQuestions(state).map((question) => {
    const values = dates.map((d) => byDate.get(d)?.answers[question.id] ?? null);
    const given = values.filter((v): v is number => v != null);
    return { question, values, answered: given.length, average: given.length ? given.reduce((a, b) => a + b, 0) / given.length : null };
  });
}
