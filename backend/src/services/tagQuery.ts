// Boolean tag expressions used to select the recordings that belong to a project.
//
// A query is a tree: groups combine their children with AND ("all of") or OR ("any of"), and any
// tag or group can be negated. Example: (tag1 AND tag2) OR tag3 OR NOT (tag4 AND tag5).

export type TagQueryOp = 'and' | 'or';

export interface TagQueryTag {
  type: 'tag';
  tag_id: number;
  not: boolean;
}

export interface TagQueryGroup {
  type: 'group';
  op: TagQueryOp;
  not: boolean;
  children: TagQueryNode[];
}

export type TagQueryNode = TagQueryTag | TagQueryGroup;

export class TagQueryError extends Error {}

const MAX_DEPTH = 6;
const MAX_NODES = 200;

export function emptyTagQuery(): TagQueryGroup {
  return { type: 'group', op: 'or', not: false, children: [] };
}

// Legacy projects stored a flat tag list plus a single AND/OR mode.
export function flatTagQuery(tagIds: number[], op: TagQueryOp): TagQueryGroup {
  return {
    type: 'group',
    op,
    not: false,
    children: tagIds.map((tag_id) => ({ type: 'tag', tag_id, not: false })),
  };
}

export function collectTagIds(node: TagQueryNode, out: Set<number> = new Set()): Set<number> {
  if (node.type === 'tag') out.add(node.tag_id);
  else node.children.forEach((c) => collectTagIds(c, out));
  return out;
}

// Drops tags rejected by `keep`, and any group left without children.
function prune(node: TagQueryNode, keep: (tagId: number) => boolean): TagQueryNode | null {
  if (node.type === 'tag') return keep(node.tag_id) ? node : null;
  const children = node.children
    .map((c) => prune(c, keep))
    .filter((c): c is TagQueryNode => c !== null);
  return children.length > 0 ? { ...node, children } : null;
}

export function pruneTagQuery(root: TagQueryGroup, keep: (tagId: number) => boolean): TagQueryGroup {
  return (prune(root, keep) as TagQueryGroup | null) ?? { ...root, children: [] };
}

// Validates untrusted input and returns a normalized query (empty groups removed).
export function parseTagQuery(raw: unknown): TagQueryGroup {
  let nodeCount = 0;

  const walk = (value: unknown, depth: number): TagQueryNode => {
    if (++nodeCount > MAX_NODES) throw new TagQueryError('Tag query is too large');
    if (depth > MAX_DEPTH) throw new TagQueryError('Tag query is nested too deeply');
    if (typeof value !== 'object' || value === null) throw new TagQueryError('Invalid tag query');

    const node = value as Record<string, unknown>;
    if (node['not'] !== undefined && typeof node['not'] !== 'boolean') {
      throw new TagQueryError("'not' must be a boolean");
    }
    const not = node['not'] === true;

    if (node['type'] === 'tag') {
      const tagId = node['tag_id'];
      if (typeof tagId !== 'number' || !Number.isInteger(tagId)) {
        throw new TagQueryError('tag_id must be an integer');
      }
      return { type: 'tag', tag_id: tagId, not };
    }

    if (node['type'] === 'group') {
      const op = node['op'];
      if (op !== 'and' && op !== 'or') throw new TagQueryError("op must be 'and' or 'or'");
      const children = node['children'];
      if (!Array.isArray(children)) throw new TagQueryError('children must be an array');
      return { type: 'group', op, not, children: children.map((c) => walk(c, depth + 1)) };
    }

    throw new TagQueryError("Node type must be 'tag' or 'group'");
  };

  const root = walk(raw, 0);
  if (root.type !== 'group') throw new TagQueryError('The root of a tag query must be a group');

  const cleaned = pruneTagQuery(root, () => true);
  if (cleaned.children.length === 0) throw new TagQueryError('Select at least one tag');
  return cleaned;
}

export function evaluateTagQuery(node: TagQueryNode, recordTagIds: ReadonlySet<number>): boolean {
  if (node.type === 'tag') {
    return recordTagIds.has(node.tag_id) !== node.not;
  }
  if (node.children.length === 0) return false;
  const matches = (c: TagQueryNode): boolean => evaluateTagQuery(c, recordTagIds);
  const result = node.op === 'and' ? node.children.every(matches) : node.children.some(matches);
  return result !== node.not;
}

// Human-readable form, e.g. "(Alpha AND Beta) OR NOT (Gamma AND Delta)".
export function tagQueryToText(root: TagQueryGroup, nameById: ReadonlyMap<number, string>): string {
  const render = (node: TagQueryNode, isRoot: boolean): string => {
    if (node.type === 'tag') {
      return `${node.not ? 'NOT ' : ''}${nameById.get(node.tag_id) ?? `#${node.tag_id}`}`;
    }
    const parts = node.children.map((c) => render(c, false));
    if (parts.length === 0) return '';
    const joined = parts.join(node.op === 'and' ? ' AND ' : ' OR ');
    if (node.not) return `NOT (${joined})`;
    return isRoot || parts.length === 1 ? joined : `(${joined})`;
  };
  return render(root, true);
}
