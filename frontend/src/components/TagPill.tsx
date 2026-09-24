import React from 'react';
import { X } from 'lucide-react';
import type { Tag } from '../api/records';
import { familyFor } from './tagColors';

interface TagPillProps {
  tag: Tag;
  onRemove?: (id: number) => void;
  onClick?: (tag: Tag) => void;
  className?: string;
}

export default function TagPill({ tag, onRemove, onClick, className = '' }: TagPillProps): React.ReactElement {
  const hasParent = tag.parent_id != null && tag.parent_name;
  const family = familyFor(tag);
  const colorClasses = hasParent ? family.child : family.root;
  const title = hasParent ? `${tag.parent_name} › ${tag.name}` : tag.name;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${colorClasses} ${
        onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''
      } ${className}`}
      title={onClick ? `Filter by ${title}` : title}
      onClick={onClick ? () => onClick(tag) : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick(tag);
              }
            }
          : undefined
      }
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
          onClick={(e) => {
            e.stopPropagation();
            onRemove(tag.id);
          }}
          className="hover:opacity-70 transition-opacity"
          aria-label={`Remove tag ${tag.name}`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}
