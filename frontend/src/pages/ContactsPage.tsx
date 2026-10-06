import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Loader2, Mail, Pencil, Phone, Plus, Search, Trash2, FolderKanban } from 'lucide-react';
import { fetchContacts, createContact, patchContact, deleteContact } from '../api/contacts';
import type { Contact } from '../api/contacts';
import ContactForm from '../components/ContactForm';
import ConfirmDialog from '../components/ConfirmDialog';

export default function ContactsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Contact | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['contacts'],
    queryFn: fetchContacts,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['contacts'] });
    void queryClient.invalidateQueries({ queryKey: ['project-contacts'] });
  };

  const createMutation = useMutation({
    mutationFn: createContact,
    onSuccess: () => { setShowForm(false); setError(null); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, values }: { id: number; values: Parameters<typeof patchContact>[1] }) => patchContact(id, values),
    onSuccess: () => { setEditingId(null); setError(null); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteContact,
    onSuccess: () => { setConfirmDelete(null); invalidate(); },
    onError: (e: Error) => { setConfirmDelete(null); setError(e.message); },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [c.name, c.role, c.email, c.phone, c.notes, ...c.projects.map((p) => p.title)].some((field) =>
        field?.toLowerCase().includes(q),
      ),
    );
  }, [contacts, search]);

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Contacts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Everyone you work with and the projects they are linked to. Link contacts to projects from the project page.
            Contacts are never used to generate reports.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setShowForm((v) => !v); setError(null); }}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          New contact
        </button>
      </div>

      {showForm && (
        <div className="bg-card rounded-lg border border-border p-4">
          <ContactForm
            submitLabel="Create"
            pending={createMutation.isPending}
            error={error}
            onSubmit={(values) => createMutation.mutate(values)}
            onCancel={() => { setShowForm(false); setError(null); }}
          />
        </div>
      )}

      {error && !showForm && editingId === null && <p className="text-sm text-destructive">{error}</p>}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, role, email, phone, project..."
          className="w-full pl-9 pr-4 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            {contacts.length === 0 ? 'No contacts yet.' : 'No contact matches your search.'}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((c) =>
              editingId === c.id ? (
                <li key={c.id} className="p-4">
                  <ContactForm
                    initial={c}
                    submitLabel="Save"
                    pending={editMutation.isPending}
                    error={error}
                    hint={
                      c.projects.length > 1
                        ? `Linked to ${c.projects.length} projects: changes apply to all of them.`
                        : undefined
                    }
                    onSubmit={(values) => editMutation.mutate({ id: c.id, values })}
                    onCancel={() => { setEditingId(null); setError(null); }}
                  />
                </li>
              ) : (
                <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="text-sm font-medium text-foreground">
                      {c.name}
                      {c.role && <span className="font-normal text-muted-foreground"> · {c.role}</span>}
                    </div>
                    {(c.email || c.phone) && (
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
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
                    )}
                    {c.notes && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{c.notes}</p>}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {c.projects.length === 0 ? (
                        <span className="text-xs text-muted-foreground/70">Not linked to any project</span>
                      ) : (
                        c.projects.map((p) => (
                          <Link
                            key={p.id}
                            to={`/projects/${p.id}`}
                            className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-secondary text-secondary-foreground hover:bg-secondary/70 transition-colors"
                          >
                            <FolderKanban className="w-3 h-3" />
                            {p.title}
                          </Link>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="flex gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => { setEditingId(c.id); setError(null); }}
                      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      aria-label={`Edit ${c.name}`}
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(c)}
                      className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label={`Delete ${c.name}`}
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete contact "${confirmDelete?.name ?? ''}"?`}
        description={
          confirmDelete && confirmDelete.projects.length > 0
            ? `The contact will also be removed from ${confirmDelete.projects.length} project${confirmDelete.projects.length === 1 ? '' : 's'} (${confirmDelete.projects.map((p) => p.title).join(', ')}). This action cannot be undone.`
            : 'This action cannot be undone.'
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
