export interface Contact {
  id: number;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  projects: Array<{ id: number; title: string }>;
}

export interface ContactInput {
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

const BASE_URL = '/api';

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(data.error ?? res.statusText);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export async function fetchContacts(): Promise<Contact[]> {
  return handleResponse<Contact[]>(await fetch(`${BASE_URL}/contacts`));
}

export async function createContact(body: ContactInput): Promise<Contact> {
  return handleResponse<Contact>(await fetch(`${BASE_URL}/contacts`, jsonRequest('POST', body)));
}

export async function patchContact(id: number, body: Partial<ContactInput>): Promise<Contact> {
  return handleResponse<Contact>(await fetch(`${BASE_URL}/contacts/${id}`, jsonRequest('PATCH', body)));
}

export async function deleteContact(id: number): Promise<void> {
  return handleResponse<void>(await fetch(`${BASE_URL}/contacts/${id}`, { method: 'DELETE' }));
}

export async function fetchProjectContacts(projectId: number): Promise<Contact[]> {
  return handleResponse<Contact[]>(await fetch(`${BASE_URL}/projects/${projectId}/contacts`));
}

// Link an existing contact, or create a new one and link it in one step.
export async function addProjectContact(
  projectId: number,
  body: { contact_id: number } | { contact: ContactInput },
): Promise<Contact> {
  return handleResponse<Contact>(await fetch(`${BASE_URL}/projects/${projectId}/contacts`, jsonRequest('POST', body)));
}

export async function removeProjectContact(projectId: number, contactId: number): Promise<void> {
  return handleResponse<void>(
    await fetch(`${BASE_URL}/projects/${projectId}/contacts/${contactId}`, { method: 'DELETE' }),
  );
}
