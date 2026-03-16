import React, { useState, useMemo } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { fetchRecords } from '../api/records';
import type { AudioRecord } from '../api/records';
import RecordDetail from './RecordDetail';
import 'react-big-calendar/lib/css/react-big-calendar.css';

const locales = { 'en-US': enUS };

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: 0 }),
  getDay,
  locales,
});

interface CalendarEvent {
  id: number;
  title: string;
  start: Date;
  end: Date;
  resource: AudioRecord;
}

export default function CalendarView(): React.ReactElement {
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null);

  // Fetch all records without pagination for calendar
  const { data, isLoading } = useQuery({
    queryKey: ['records', 'calendar'],
    queryFn: () => fetchRecords({ limit: 1000 }),
    refetchInterval: 30000,
  });

  const events = useMemo<CalendarEvent[]>(() => {
    if (!data?.data) return [];
    return data.data.map((record) => {
      const start = new Date(record.recorded_at * 1000);
      const durationMs = (record.duration_seconds ?? 3600) * 1000;
      const end = new Date(start.getTime() + durationMs);
      const displayName = record.display_name ?? record.original_name;

      return {
        id: record.id,
        title: displayName.replace(/\.\w+$/, ''),
        start,
        end,
        resource: record,
      };
    });
  }, [data]);

  const eventStyleGetter = (event: CalendarEvent): { style: React.CSSProperties } => {
    const statusColors: Record<string, string> = {
      pending: '#6b7280',
      transcribing: '#3b82f6',
      transcribed: '#14b8a6',
      processing: '#f59e0b',
      done: '#22c55e',
      error: '#ef4444',
    };
    const color = statusColors[event.resource.status] ?? '#6b7280';
    return {
      style: {
        backgroundColor: color,
        borderRadius: '4px',
        border: 'none',
        color: 'white',
        fontSize: '11px',
        padding: '1px 4px',
      },
    };
  };

  const handleSelectEvent = (event: CalendarEvent): void => {
    setSelectedRecordId(event.id);
  };

  return (
    <div className="flex h-full">
      {/* Calendar */}
      <div className={`flex-1 p-4 min-w-0 ${selectedRecordId !== null ? 'hidden md:block' : ''}`}>
        <h1 className="text-xl font-bold text-foreground mb-4">Calendar</h1>

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="bg-card rounded-lg border border-border p-4" style={{ height: 'calc(100vh - 140px)' }}>
            <Calendar
              localizer={localizer}
              events={events}
              startAccessor="start"
              endAccessor="end"
              onSelectEvent={handleSelectEvent}
              eventPropGetter={eventStyleGetter}
              views={['month', 'week', 'day']}
              defaultView="month"
              popup
              style={{ height: '100%' }}
            />
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-4 mt-3 text-xs text-muted-foreground">
          {[
            { status: 'pending', color: 'bg-gray-500', label: 'Pending' },
            { status: 'transcribing', color: 'bg-blue-500', label: 'Transcribing' },
            { status: 'transcribed', color: 'bg-teal-500', label: 'Transcribed' },
            { status: 'processing', color: 'bg-amber-500', label: 'Processing' },
            { status: 'done', color: 'bg-green-500', label: 'Done' },
            { status: 'error', color: 'bg-red-500', label: 'Error' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className={`w-3 h-3 rounded-sm ${color}`} />
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Side sheet */}
      {selectedRecordId !== null && (
        <div className="w-full md:w-[480px] border-l border-border flex flex-col shrink-0">
          <RecordDetail
            recordId={selectedRecordId}
            onClose={() => setSelectedRecordId(null)}
          />
        </div>
      )}
    </div>
  );
}
