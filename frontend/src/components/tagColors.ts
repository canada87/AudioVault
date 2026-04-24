import type { Tag } from '../api/records';

// Family palette: each entry has a "root" (darker) and "child" (lighter) variant
// for the full pill, plus a "filterSelected" and "filterUnselected" variant used
// by the filter chips in the recordings page toolbar. Classes are enumerated
// statically so Tailwind JIT picks them up.
export interface FamilyColors {
  root: string;
  child: string;
  prefix: string;
  separator: string;
  filterUnselected: string;
  filterSelected: string;
}

export const FAMILY_PALETTE: readonly FamilyColors[] = [
  {
    root: 'bg-sky-500/20 text-sky-800 dark:text-sky-200 border-sky-500/40',
    child: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25',
    prefix: 'text-sky-700/70 dark:text-sky-300/70',
    separator: 'text-sky-600/50 dark:text-sky-400/50',
    filterUnselected: 'bg-sky-500/5 text-sky-700 dark:text-sky-300 border-sky-500/30 hover:border-sky-500/60 hover:bg-sky-500/10',
    filterSelected: 'bg-sky-500/30 text-sky-900 dark:text-sky-100 border-sky-500/60',
  },
  {
    root: 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 border-emerald-500/40',
    child: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
    prefix: 'text-emerald-700/70 dark:text-emerald-300/70',
    separator: 'text-emerald-600/50 dark:text-emerald-400/50',
    filterUnselected: 'bg-emerald-500/5 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:border-emerald-500/60 hover:bg-emerald-500/10',
    filterSelected: 'bg-emerald-500/30 text-emerald-900 dark:text-emerald-100 border-emerald-500/60',
  },
  {
    root: 'bg-amber-500/20 text-amber-800 dark:text-amber-200 border-amber-500/40',
    child: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25',
    prefix: 'text-amber-800/70 dark:text-amber-300/70',
    separator: 'text-amber-700/50 dark:text-amber-400/50',
    filterUnselected: 'bg-amber-500/5 text-amber-800 dark:text-amber-300 border-amber-500/30 hover:border-amber-500/60 hover:bg-amber-500/10',
    filterSelected: 'bg-amber-500/30 text-amber-900 dark:text-amber-100 border-amber-500/60',
  },
  {
    root: 'bg-rose-500/20 text-rose-800 dark:text-rose-200 border-rose-500/40',
    child: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25',
    prefix: 'text-rose-700/70 dark:text-rose-300/70',
    separator: 'text-rose-600/50 dark:text-rose-400/50',
    filterUnselected: 'bg-rose-500/5 text-rose-700 dark:text-rose-300 border-rose-500/30 hover:border-rose-500/60 hover:bg-rose-500/10',
    filterSelected: 'bg-rose-500/30 text-rose-900 dark:text-rose-100 border-rose-500/60',
  },
  {
    root: 'bg-violet-500/20 text-violet-800 dark:text-violet-200 border-violet-500/40',
    child: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/25',
    prefix: 'text-violet-700/70 dark:text-violet-300/70',
    separator: 'text-violet-600/50 dark:text-violet-400/50',
    filterUnselected: 'bg-violet-500/5 text-violet-700 dark:text-violet-300 border-violet-500/30 hover:border-violet-500/60 hover:bg-violet-500/10',
    filterSelected: 'bg-violet-500/30 text-violet-900 dark:text-violet-100 border-violet-500/60',
  },
  {
    root: 'bg-teal-500/20 text-teal-800 dark:text-teal-200 border-teal-500/40',
    child: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/25',
    prefix: 'text-teal-700/70 dark:text-teal-300/70',
    separator: 'text-teal-600/50 dark:text-teal-400/50',
    filterUnselected: 'bg-teal-500/5 text-teal-700 dark:text-teal-300 border-teal-500/30 hover:border-teal-500/60 hover:bg-teal-500/10',
    filterSelected: 'bg-teal-500/30 text-teal-900 dark:text-teal-100 border-teal-500/60',
  },
  {
    root: 'bg-orange-500/20 text-orange-800 dark:text-orange-200 border-orange-500/40',
    child: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/25',
    prefix: 'text-orange-700/70 dark:text-orange-300/70',
    separator: 'text-orange-600/50 dark:text-orange-400/50',
    filterUnselected: 'bg-orange-500/5 text-orange-700 dark:text-orange-300 border-orange-500/30 hover:border-orange-500/60 hover:bg-orange-500/10',
    filterSelected: 'bg-orange-500/30 text-orange-900 dark:text-orange-100 border-orange-500/60',
  },
  {
    root: 'bg-indigo-500/20 text-indigo-800 dark:text-indigo-200 border-indigo-500/40',
    child: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/25',
    prefix: 'text-indigo-700/70 dark:text-indigo-300/70',
    separator: 'text-indigo-600/50 dark:text-indigo-400/50',
    filterUnselected: 'bg-indigo-500/5 text-indigo-700 dark:text-indigo-300 border-indigo-500/30 hover:border-indigo-500/60 hover:bg-indigo-500/10',
    filterSelected: 'bg-indigo-500/30 text-indigo-900 dark:text-indigo-100 border-indigo-500/60',
  },
] as const;

export function familyFor(tag: Pick<Tag, 'id' | 'parent_id'>): FamilyColors {
  // Children share their root's family; roots/orphans use their own id.
  const familyId = tag.parent_id ?? tag.id;
  return FAMILY_PALETTE[familyId % FAMILY_PALETTE.length];
}
