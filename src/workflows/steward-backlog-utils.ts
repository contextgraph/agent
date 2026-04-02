import type { StewardClaimedListResource } from '../api-client.js';

export function matchesBacklogIdentifier(resource: StewardClaimedListResource, identifier: string): boolean {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return false;

  return [
    resource.backlog_item.id,
    resource.backlog_item.backlog_reference,
    resource.backlog_item.backlog_slug ? `${resource.steward.slug}/${resource.backlog_item.backlog_slug}` : undefined,
  ]
    .filter((value): value is string => !!value)
    .some((value) => value.toLowerCase() === normalized);
}

export function resolveClaimedBacklogItem(
  items: StewardClaimedListResource[],
  identifier?: string
): StewardClaimedListResource {
  if (identifier?.trim()) {
    const match = items.find((item) => matchesBacklogIdentifier(item, identifier));
    if (!match) {
      throw new Error(
        `No claimed steward backlog item matched "${identifier}". Run \`steward backlog claimed\` to inspect active items first.`
      );
    }
    return match;
  }

  if (items.length === 1) {
    return items[0];
  }

  throw new Error('Multiple claimed backlog items are active. Pass an identifier or run `steward backlog claimed` first.');
}

export function requiredBranchMessage(branchName: string): string {
  return `You must do this backlog work on branch \`${branchName}\`. Steward uses this exact branch name to automatically link the resulting PR back to the claimed backlog item.`;
}

export function backlogLinkLine(backlogItemId: string): string {
  return `Steward-Backlog-Item: ${backlogItemId}`;
}

export function extractLinkedBacklogItemId(body: string | null | undefined): string | null {
  if (!body) {
    return null;
  }

  const match = body.match(/(?:^|\n)\s*Steward-Backlog-Item:\s*([0-9a-fA-F-]{36})\s*(?:\n|$)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function buildLinkedPrBody(body: string | null | undefined, backlogItemId: string): string {
  const marker = backlogLinkLine(backlogItemId);
  const trimmed = (body ?? '').trimEnd();
  if (!trimmed) {
    return marker;
  }
  if (trimmed.includes(marker)) {
    return trimmed;
  }
  return `${trimmed}\n\n${marker}`;
}

export function sanitizeBranchForPath(branchName: string): string {
  return branchName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'steward-worktree';
}

export function normalizeRepositoryUrl(input: string): string {
  const trimmed = input.trim().replace(/\.git$/i, '');
  if (trimmed.startsWith('git@github.com:')) {
    return `https://github.com/${trimmed.slice('git@github.com:'.length)}`.toLowerCase();
  }
  if (trimmed.startsWith('ssh://git@github.com/')) {
    return `https://github.com/${trimmed.slice('ssh://git@github.com/'.length)}`.toLowerCase();
  }
  return trimmed.toLowerCase();
}

