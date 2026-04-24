import React from 'react';
import { X } from 'lucide-react';
import type { Tag } from '../api/records';

interface TagPillProps {
  tag: Tag;
  onRemove?: (id: number) => void;
  className?: string;
}

export default function TagPill({ tag, onRemove, className = '' }: TagPillProps): React.ReactElement {
  const hasParent = tag.parent_id != null && tag.parent_name;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20 ${className}`}
      title={hasParent ? `${tag.parent_name} › ${tag.name}` : tag.name}
    >
      {hasParent && (
        <>
          <span className="text-primary/60">{tag.parent_name}</span>
          <span className="text-primary/40">›</span>
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
