type NormalizedGithubEvent = {
  actor: string | null;
  eventType: string;
  subject: string;
  summary: string;
  occurredAt: string;
  environment: string | null;
  service: string | null;
  repository: string | null;
  commitSha: string | null;
  deploymentId: string | null;
  deploymentUrl: string | null;
  prNumber: number | null;
};

function stringValue(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function valueAt(value: unknown, ...path: Array<string | number>): unknown {
  let current = value;
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
      continue;
    }
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function repositoryName(payload: unknown) {
  return stringValue(valueAt(payload, 'repository', 'full_name'));
}

function identifierValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return stringValue(value);
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }

  return undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? parsed
        : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function timestampValue(value: unknown) {
  const date = typeof value === 'number'
    ? new Date(value < 1_000_000_000_000 ? value * 1000 : value)
    : typeof value === 'string'
      ? new Date(value)
      : undefined;

  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
}

function githubOccurredAt(eventName: string, payload: unknown, fallback: string) {
  const action = stringValue(valueAt(payload, 'action'));
  const pullRequestTimestamp = valueAt(payload, 'pull_request', 'merged') === true
    ? valueAt(payload, 'pull_request', 'merged_at')
    : action === 'closed'
      ? valueAt(payload, 'pull_request', 'closed_at')
      : action === 'opened'
        ? valueAt(payload, 'pull_request', 'created_at')
        : valueAt(payload, 'pull_request', 'updated_at');
  const issueTimestamp = action === 'opened'
    ? valueAt(payload, 'issue', 'created_at')
    : action === 'closed'
      ? valueAt(payload, 'issue', 'closed_at')
      : valueAt(payload, 'issue', 'updated_at');

  const candidates = eventName === 'pull_request'
    ? [pullRequestTimestamp]
    : eventName === 'issues' || eventName === 'issue_comment'
      ? [issueTimestamp, valueAt(payload, 'comment', 'created_at'), valueAt(payload, 'comment', 'updated_at')]
      : eventName === 'push' || eventName === 'create' || eventName === 'delete'
        ? [valueAt(payload, 'head_commit', 'timestamp'), valueAt(payload, 'repository', 'pushed_at')]
        : [
            valueAt(payload, 'deployment_status', 'created_at'),
            valueAt(payload, 'deployment_status', 'updated_at'),
            valueAt(payload, 'deployment', 'created_at'),
            valueAt(payload, 'workflow_run', 'updated_at'),
            valueAt(payload, 'workflow_run', 'run_started_at'),
            valueAt(payload, 'workflow_run', 'created_at'),
            valueAt(payload, 'release', 'published_at'),
            valueAt(payload, 'release', 'created_at'),
            valueAt(payload, 'check_run', 'completed_at'),
            valueAt(payload, 'check_run', 'started_at'),
          ];

  for (const candidate of candidates) {
    const timestamp = timestampValue(candidate);
    if (timestamp) return timestamp;
  }

  return fallback;
}

function commitSha(eventName: string, payload: unknown) {
  const candidates = eventName === 'pull_request'
    ? [
        valueAt(payload, 'pull_request', 'merged') === true
          ? valueAt(payload, 'pull_request', 'merge_commit_sha')
          : valueAt(payload, 'pull_request', 'head', 'sha'),
      ]
    : eventName === 'push'
      ? [valueAt(payload, 'after'), valueAt(payload, 'before')]
      : [
          valueAt(payload, 'deployment', 'sha'),
          valueAt(payload, 'workflow_run', 'head_sha'),
          valueAt(payload, 'check_run', 'head_sha'),
          valueAt(payload, 'check_suite', 'head_sha'),
          valueAt(payload, 'commit', 'sha'),
          valueAt(payload, 'comment', 'commit_id'),
        ];

  for (const candidate of candidates) {
    const sha = stringValue(candidate);
    if (sha && !/^0+$/.test(sha)) return sha;
  }

  return null;
}

function pullRequestNumber(eventName: string, payload: unknown) {
  const number = numberValue(valueAt(payload, 'pull_request', 'number'))
    ?? (eventName.startsWith('pull_request') ? numberValue(valueAt(payload, 'number')) : undefined)
    ?? (valueAt(payload, 'issue', 'pull_request') ? numberValue(valueAt(payload, 'issue', 'number')) : undefined)
    ?? numberValue(valueAt(payload, 'workflow_run', 'pull_requests', 0, 'number'));

  return number ?? null;
}

function referenceDetails(payload: unknown) {
  const ref = stringValue(valueAt(payload, 'ref')) ?? 'unknown';
  const refType = stringValue(valueAt(payload, 'ref_type'))
    ?? (ref.startsWith('refs/tags/') ? 'tag' : 'branch');
  const refName = ref.replace(/^refs\/(heads|tags)\//, '');

  return { refType, refName };
}

export function normalizeGithubEvent(
  eventName: string,
  payload: unknown,
  ingestedAt = new Date().toISOString(),
): NormalizedGithubEvent {
  const actor = stringValue(valueAt(payload, 'sender', 'login')) ?? null;
  const actorName = actor ?? 'Unknown actor';
  const repository = repositoryName(payload) ?? null;
  const repositoryDisplay = repository ?? 'unknown repository';
  const deploymentPayload = objectValue(valueAt(payload, 'deployment', 'payload'));
  const environment = stringValue(valueAt(payload, 'deployment_status', 'environment'))
    ?? stringValue(valueAt(payload, 'deployment', 'environment'))
    ?? stringValue(valueAt(deploymentPayload, 'environment'))
    ?? null;
  const service = stringValue(valueAt(deploymentPayload, 'service'))
    ?? stringValue(valueAt(deploymentPayload, 'service_name'))
    ?? null;
  const metadata = {
    occurredAt: githubOccurredAt(eventName, payload, ingestedAt),
    environment,
    service,
    repository,
    commitSha: commitSha(eventName, payload),
    deploymentId: identifierValue(valueAt(payload, 'deployment', 'id'))
      ?? identifierValue(valueAt(payload, 'deployment_status', 'deployment_id'))
      ?? identifierValue(valueAt(payload, 'workflow_run', 'id'))
      ?? null,
    deploymentUrl: stringValue(valueAt(payload, 'deployment_status', 'target_url'))
      ?? stringValue(valueAt(payload, 'deployment_status', 'environment_url'))
      ?? stringValue(valueAt(payload, 'deployment', 'url'))
      ?? stringValue(valueAt(payload, 'workflow_run', 'html_url'))
      ?? null,
    prNumber: pullRequestNumber(eventName, payload),
  };

  if (eventName === 'create' || eventName === 'delete') {
    const { refType, refName } = referenceDetails(payload);
    const action = eventName === 'create' ? 'created' : 'deleted';
    const preposition = eventName === 'create' ? 'in' : 'from';

    return {
      actor,
      eventType: `${refType}.${action}`,
      subject: `${repositoryDisplay}:${refType}/${refName}`,
      summary: `${actorName} ${action} ${refType} "${refName}" ${preposition} "${repositoryDisplay}"`,
      ...metadata,
    };
  }

  if (eventName === 'push') {
    const { refType, refName } = referenceDetails(payload);
    const action = valueAt(payload, 'deleted') === true
      ? 'deleted'
      : valueAt(payload, 'created') === true
        ? 'created'
        : valueAt(payload, 'forced') === true
          ? 'force_pushed'
          : 'pushed';
    const summary = action === 'deleted'
      ? `${actorName} deleted ${refType} "${refName}" from "${repositoryDisplay}"`
      : action === 'created'
        ? `${actorName} created ${refType} "${refName}" in "${repositoryDisplay}"`
        : action === 'force_pushed'
          ? `${actorName} force-pushed ${refType} "${refName}" in "${repositoryDisplay}"`
          : `${actorName} pushed to ${refType} "${refName}" in "${repositoryDisplay}"`;

    return {
      actor,
      eventType: `${refType}.${action}`,
      subject: `${repositoryDisplay}:${refType}/${refName}`,
      summary,
      ...metadata,
    };
  }

  if (eventName === 'pull_request') {
    const action = valueAt(payload, 'pull_request', 'merged') === true
      ? 'merged'
      : stringValue(valueAt(payload, 'action')) ?? 'updated';
    const number = metadata.prNumber;
    const subject = number ? `${repositoryDisplay}#${number}` : repositoryDisplay;

    return {
      actor,
      eventType: `pull_request.${action}`,
      subject,
      summary: `${actorName} ${action} pull request${number ? ` #${number}` : ''} in "${repositoryDisplay}"`,
      ...metadata,
    };
  }

  if (eventName === 'deployment_status') {
    const state = stringValue(valueAt(payload, 'deployment_status', 'state')) ?? 'updated';
    const subject = environment
      ? `${repositoryDisplay}:${environment}`
      : repositoryDisplay;

    return {
      actor,
      eventType: `deployment.${state}`,
      subject,
      summary: `${actorName} marked deployment${environment ? ` to "${environment}"` : ''} as ${state} for "${repositoryDisplay}"`,
      ...metadata,
    };
  }

  if (eventName === 'deployment') {
    const action = stringValue(valueAt(payload, 'action')) ?? 'created';
    const subject = environment
      ? `${repositoryDisplay}:${environment}`
      : repositoryDisplay;

    return {
      actor,
      eventType: `deployment.${action}`,
      subject,
      summary: `${actorName} ${action} deployment${environment ? ` to "${environment}"` : ''} for "${repositoryDisplay}"`,
      ...metadata,
    };
  }

  const action = stringValue(valueAt(payload, 'action'));
  const number = metadata.prNumber ?? numberValue(valueAt(payload, 'issue', 'number'));
  const subject = number ? `${repositoryDisplay}#${number}` : repositoryDisplay;

  return {
    actor,
    eventType: action ? `${eventName}.${action}` : `${eventName}.received`,
    subject,
    summary: `${actorName} ${action ?? 'triggered'} ${eventName} for "${subject}"`,
    ...metadata,
  };
}

export function parseGithubPayload(body: string, contentType?: string): unknown {
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  const payload = mediaType === 'application/x-www-form-urlencoded'
    ? new URLSearchParams(body).get('payload')
    : body;

  if (payload === null) {
    throw new SyntaxError('Missing form field "payload"');
  }

  return JSON.parse(payload);
}
