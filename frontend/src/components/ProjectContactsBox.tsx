import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Loader2, Mail, Pencil, Phone, Plus, UserPlus, Users, X } from 'lucide-react';
import {
  addProjectContact,
  fetchContacts,
  fetchProjectContacts,
  patchContact,
  removeProjectContact,
} from '../api/contacts';
import type { Contact, ContactInput } from '../api/contacts';
import ContactForm from './ContactForm';

interface ProjectContactsBoxProps {
  projectId: number;
}

type AddMode = 'existing' | 'new';

// Contacts of one project. Local to the app: never sent to the LLM.
export default function ProjectContactsBox({ projectId }: ProjectContactsBoxProps): React.ReactElement {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>('existing');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: projectContacts = [], isLoading } = useQuery({
    queryKey: ['project-contacts', projectId],
    queryFn: () => fetchProjectContacts(projectId),
  });

  // Only needed to pick an existing contact.
  const { data: allContacts } = useQuery({
    queryKey: ['contacts'],
    queryFn: fetchContacts,
    enabled: adding,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['project-contacts', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['contacts'] });
  };

  const closeAdd = (): void => {
    setAdding(false);
    setSearch('');
    setError(null);
  };

  const addMutation = useMutation({
    mutationFn: (body: Parameters<typeof addProjectContact>[1]) => addProjectContact(projectId, body),
    onSuccess: () => { closeAdd(); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, values }: { id: number; values: ContactInput }) => patchContact(id, values),
    onSuccess: () => { setEditingId(null); setError(null); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: (contactId: number) => removeProjectContact(projectId, contactId),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  const linkedIds = new Set(projectContacts.map((c) => c.id));
  const q = search.trim().toLowerCase();
  const candidates = (allContacts ?? []).filter(
    (c) =>
      !linkedIds.has(c.id) &&
      (!q || [c.name, c.role, c.email].some((field) => field?.toLowerCase().includes(q))),
  );
  // With nobody to pick from, "New" is the only useful tab (decided only once the list has loaded).
  const noExisting = allContacts !== undefined && allContacts.every((c) => linkedIds.has(c.id));
  const effectiveMode: AddMode = noExisting ? 'new' : addMode;

  const renderContact = (c: Contact): React.ReactElement => {
    const otherProjects = c.projects.filter((p) => p.id !== projectId);

    if (editingId === c.id) {
      return (
        <li key={c.id} className="py-3">
          <ContactForm
            initial={c}
            submitLabel="Save"
            pending={editMutation.isPending}
            error={error}
            hint={
              otherProjects.length > 0
                ? `Also in ${otherProjects.length} other project${otherProjects.length === 1 ? '' : 's'}: changes apply everywhere.`
                : undefined
            }
            onSubmit={(values) => editMutation.mutate({ id: c.id, values })}
            onCancel={() => { setEditingId(null); setError(null); }}
          />
        </li>
      );
    }

    return (
      <li key={c.id} className="py-2.5 group">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground">
              {c.name}
              {c.role && <span className="font-normal text-muted-foreground"> · {c.role}</span>}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
              {c.email && (
                <a href={`mailto:${c.email}`} className="flex items-center gap-1 hover:text-foreground break-all">
                  <Mail className="w-3 h-3 shrink-0" />
                  {c.email}
                </a>
              )}
              {c.phone && (
                <a href={`tel:${c.phone}`} className="flex items-center gap-1 hover:text-foreground">
                  <Phone className="w-3 h-3 shrink-0" />
                  {c.phone}
                </a>
              )}
            </div>
            {c.notes && <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{c.notes}</p>}
            {otherProjects.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Also in:{' '}
                {otherProjects.map((p, i) => (
                  <React.Fragment key={p.id}>
                    {i > 0 && ', '}
                    <Link to={`/projects/${p.id}`} className="underline hover:text-foreground">
                      {p.title}
                    </Link>
                  </React.Fragment>
                ))}
              </p>
            )}
          </div>
          <div className="flex gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => { setEditingId(c.id); setError(null); }}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label={`Edit ${c.name}`}
              title="Edit contact"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => removeMutation.mutate(c.id)}
              disabled={removeMutation.isPending}
              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
              aria-label={`Remove ${c.name} from this project`}
              title="Remove from this project (the contact is kept)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-muted-foreground">
          Contacts{projectContacts.length > 0 && ` (${projectContacts.length})`}
        </span>
        {!adding && (
          <button
            type="button"
            onClick={() => { setAdding(true); setAddMode('existing'); setError(null); }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-2">
        People linked to this project — kept locally, never sent to the LLM.
      </p>

      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      ) : projectContacts.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground py-2">No contacts yet.</p>
      ) : (
        <ul className="divide-y divide-border">{projectContacts.map(renderContact)}</ul>
      )}

      {adding && (
        <div className="mt-3 rounded-md border border-border bg-muted/30 p-3 space-y-3">
          {!noExisting && (
            <div className="inline-flex rounded-md border border-input overflow-hidden divide-x divide-input">
              {(['existing', 'new'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => { setAddMode(mode); setError(null); }}
                  className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors ${
                    effectiveMode === mode
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {mode === 'existing' ? <Users className="w-3 h-3" /> : <UserPlus className="w-3 h-3" />}
                  {mode === 'existing' ? 'Existing' : 'New'}
                </button>
              ))}
            </div>
          )}

          {effectiveMode === 'existing' ? (
            <div className="space-y-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search contacts..."
                autoFocus
                className="w-full px-2.5 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <ul className="max-h-48 overflow-auto divide-y divide-border rounded-md border border-border bg-background">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => addMutation.mutate({ contact_id: c.id })}
                      disabled={addMutation.isPending}
                      className="w-full text-left px-2.5 py-1.5 hover:bg-accent disabled:opacity-50 transition-colors"
                    >
                      <div className="text-sm text-foreground">
                        {c.name}
                        {c.role && <span className="text-muted-foreground"> · {c.role}</span>}
                      </div>
                      {c.projects.length > 0 && (
                        <div className="text-xs text-muted-foreground truncate">
                          In: {c.projects.map((p) => p.title).join(', ')}
                        </div>
                      )}
                    </button>
                  </li>
                ))}
                {allContacts === undefined ? (
                  <li className="px-2.5 py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                  </li>
                ) : (
                  candidates.length === 0 && (
                    <li className="px-2.5 py-2 text-xs text-muted-foreground">No matching contact.</li>
                  )
                )}
              </ul>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={closeAdd}
                  className="px-2.5 py-1 text-xs rounded-md border border-input bg-background hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <ContactForm
              submitLabel="Add contact"
              pending={addMutation.isPending}
              error={error}
              onSubmit={(values) => addMutation.mutate({ contact: values })}
              onCancel={closeAdd}
            />
          )}
        </div>
      )}

      {!adding && error && editingId === null && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
