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

export const SCALE = [1, 2, 3, 4, 5] as const;

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
