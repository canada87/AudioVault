import React from 'react';

interface DurationDisplayProps {
  seconds: number | null | undefined;
  className?: string;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function DurationDisplay({ seconds, className = '' }: DurationDisplayProps): React.ReactElement {
  return (
    <span className={`text-sm tabular-nums text-muted-foreground ${className}`}>
      {formatDuration(seconds)}
    </span>
  );
}
