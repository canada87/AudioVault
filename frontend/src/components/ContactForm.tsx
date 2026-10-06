import React, { useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import type { ContactInput } from '../api/contacts';

interface ContactFormProps {
  initial?: Partial<ContactInput>;
  submitLabel: string;
  pending?: boolean;
  error?: string | null;
  // Shown above the fields, e.g. a warning that edits affect several projects.
  hint?: string;
  onSubmit: (values: ContactInput) => void;
  onCancel: () => void;
}

const inputClasses =
  'w-full px-2.5 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring';

export default function ContactForm({
  initial,
  submitLabel,
  pending = false,
  error,
  hint,
  onSubmit,
  onCancel,
}: ContactFormProps): React.ReactElement {
  const [name, setName] = useState(initial?.name ?? '');
  const [role, setRole] = useState(initial?.role ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const canSubmit = name.trim().length > 0 && !pending;

  const submit = (): void => {
    if (!canSubmit) return;
    // The backend turns blank optional fields into null; send them as-is.
    onSubmit({ name, role, email, phone, notes });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-2"
    >
      {hint && <p className="text-xs text-amber-700 dark:text-amber-400">{hint}</p>}
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name *"
        autoFocus
        className={inputClasses}
      />
      <div className="grid grid-cols-2 gap-2">
        <input type="text" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role" className={inputClasses} />
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile" className={inputClasses} />
      </div>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className={inputClasses} />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Notes"
        className={`${inputClasses} resize-y`}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-input bg-background hover:bg-accent disabled:opacity-50 transition-colors"
        >
          <X className="w-3 h-3" />
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
