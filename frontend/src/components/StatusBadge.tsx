import React from 'react';
import type { AudioRecord } from '../api/records';

type Status = AudioRecord['status'];

const statusConfig: Record<Status, { label: string; className: string }> = {
  pending: {
    label: 'Pending',
    className: 'bg-gray-100 text-gray-700 border-gray-200',
  },
  transcribing: {
    label: 'Transcribing',
    className: 'bg-blue-100 text-blue-700 border-blue-200',
  },
  transcribed: {
    label: 'Transcribed',
    className: 'bg-teal-100 text-teal-700 border-teal-200',
  },
  processing: {
    label: 'Processing',
    className: 'bg-amber-100 text-amber-700 border-amber-200',
  },
  done: {
    label: 'Done',
    className: 'bg-green-100 text-green-700 border-green-200',
  },
  error: {
    label: 'Error',
    className: 'bg-red-100 text-red-700 border-red-200',
  },
};

interface StatusBadgeProps {
  status: Status;
  className?: string;
}

export default function StatusBadge({ status, className = '' }: StatusBadgeProps): React.ReactElement {
  const config = statusConfig[status] ?? statusConfig.pending;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${config.className} ${className}`}
    >
      {config.label}
    </span>
  );
}
