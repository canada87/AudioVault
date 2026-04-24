import React from 'react';
import { X } from 'lucide-react';
import type { Tag } from '../api/records';

interface TagPillProps {
  tag: Tag;
  onRemove?: (id: number) => void;
  className?: string;
}

// Family palette: each entry has a "root" (darker) and "child" (lighter) variant.
// Classes are enumerated statically so Tailwind JIT picks them up.
const FAMILY_PALETTE = [
  {
    root: 'bg-sky-500/20 text-sky-800 dark:text-sky-200 border-sky-500/40',
    child: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25',
    prefix: 'text-sky-700/70 dark:text-sky-300/70',
    separator: 'text-sky-600/50 dark:text-sky-400/50',
  },
  {
    root: 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 border-emerald-500/40',
    child: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
    prefix: 'text-emerald-700/70 dark:text-emerald-300/70',
    separator: 'text-emerald-600/50 dark:text-emerald-400/50',
  },
  {
    root: 'bg-amber-500/20 text-amber-800 dark:text-amber-200 border-amber-500/40',
    child: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25',
    prefix: 'text-amber-800/70 dark:text-amber-300/70',
    separator: 'text-amber-700/50 dark:text-amber-400/50',
  },
  {
    root: 'bg-rose-500/20 text-rose-800 dark:text-rose-200 border-rose-500/40',
    child: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25',
    prefix: 'text-rose-700/70 dark:text-rose-300/70',
    separator: 'text-rose-600/50 dark:text-rose-400/50',
  },
  {
    root: 'bg-violet-500/20 text-violet-800 dark:text-violet-200 border-violet-500/40',
    child: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/25',
    prefix: 'text-violet-700/70 dark:text-violet-300/70',
    separator: 'text-violet-600/50 dark:text-violet-400/50',
  },
  {
    root: 'bg-teal-500/20 text-teal-800 dark:text-teal-200 border-teal-500/40',
    child: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/25',
    prefix: 'text-teal-700/70 dark:text-teal-300/70',
    separator: 'text-teal-600/50 dark:text-teal-400/50',
  },
  {
    root: 'bg-orange-500/20 text-orange-800 dark:text-orange-200 border-orange-500/40',
    child: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/25',
    prefix: 'text-orange-700/70 dark:text-orange-300/70',
    separator: 'text-orange-600/50 dark:text-orange-400/50',
  },
  {
    root: 'bg-indigo-500/20 text-indigo-800 dark:text-indigo-200 border-indigo-500/40',
    child: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/25',
    prefix: 'text-indigo-700/70 dark:text-indigo-300/70',
    separator: 'text-indigo-600/50 dark:text-indigo-400/50',
  },
] as const;

function familyFor(tag: Tag): (typeof FAMILY_PALETTE)[number] {
  // Children share their root's family; orphans/roots use their own id.
  const familyId = tag.parent_id ?? tag.id;
  return FAMILY_PALETTE[familyId % FAMILY_PALETTE.length];
}

export default function TagPill({ tag, onRemove, className = '' }: TagPillProps): React.ReactElement {
  const hasParent = tag.parent_id != null && tag.parent_name;
  const family = familyFor(tag);
  const colorClasses = hasParent ? family.child : family.root;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${colorClasses} ${className}`}
      title={hasParent ? `${tag.parent_name} › ${tag.name}` : tag.name}
    >
      {hasParent && (
        <>
          <span className={family.prefix}>{tag.parent_name}</span>
          <span className={family.separator}>›</span>
        </>
      )}
      <span>{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(tag.id)}
          className="hover:opacity-70 transition-opacity"
          aria-label={`Remove tag ${tag.name}`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}
