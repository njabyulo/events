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

function repositoryName(payload: any) {
  return stringValue(payload.repository?.full_name);
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

function objectValue(value: unknown): Record<string, any> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, any>;
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

function githubOccurredAt(eventName: string, payload: any, fallback: string) {
  const action = stringValue(payload.action);
  const pullRequestTimestamp = payload.pull_request?.merged === true
    ? payload.pull_request?.merged_at
    : action === 'closed'
      ? payload.pull_request?.closed_at
      : action === 'opened'
        ? payload.pull_request?.created_at
        : payload.pull_request?.updated_at;
  const issueTimestamp = action === 'opened'
    ? payload.issue?.created_at
    : action === 'closed'
      ? payload.issue?.closed_at
      : payload.issue?.updated_at;

  const candidates = eventName === 'pull_request'
    ? [pullRequestTimestamp]
    : eventName === 'issues' || eventName === 'issue_comment'
      ? [issueTimestamp, payload.comment?.created_at, payload.comment?.updated_at]
      : eventName === 'push' || eventName === 'create' || eventName === 'delete'
        ? [payload.head_commit?.timestamp, payload.repository?.pushed_at]
        : [
            payload.deployment_status?.created_at,
            payload.deployment_status?.updated_at,
            payload.deployment?.created_at,
            payload.workflow_run?.updated_at,
            payload.workflow_run?.run_started_at,
            payload.workflow_run?.created_at,
            payload.release?.published_at,
            payload.release?.created_at,
            payload.check_run?.completed_at,
            payload.check_run?.started_at,
          ];

  for (const candidate of candidates) {
    const timestamp = timestampValue(candidate);
    if (timestamp) return timestamp;
  }

  return fallback;
}

function commitSha(eventName: string, payload: any) {
  const candidates = eventName === 'pull_request'
    ? [
        payload.pull_request?.merged === true
          ? payload.pull_request?.merge_commit_sha
          : payload.pull_request?.head?.sha,
      ]
    : eventName === 'push'
      ? [payload.after, payload.before]
      : [
          payload.deployment?.sha,
          payload.workflow_run?.head_sha,
          payload.check_run?.head_sha,
          payload.check_suite?.head_sha,
          payload.commit?.sha,
          payload.comment?.commit_id,
        ];

  for (const candidate of candidates) {
    const sha = stringValue(candidate);
    if (sha && !/^0+$/.test(sha)) return sha;
  }

  return null;
}

function pullRequestNumber(eventName: string, payload: any) {
  const number = numberValue(payload.pull_request?.number)
    ?? (eventName.startsWith('pull_request') ? numberValue(payload.number) : undefined)
    ?? (payload.issue?.pull_request ? numberValue(payload.issue?.number) : undefined)
    ?? numberValue(payload.workflow_run?.pull_requests?.[0]?.number);

  return number ?? null;
}

function referenceDetails(payload: any) {
  const ref = stringValue(payload.ref) ?? 'unknown';
  const refType = stringValue(payload.ref_type)
    ?? (ref.startsWith('refs/tags/') ? 'tag' : 'branch');
  const refName = ref.replace(/^refs\/(heads|tags)\//, '');

  return { refType, refName };
}

export function normalizeGithubEvent(
  eventName: string,
  payload: any,
  ingestedAt = new Date().toISOString(),
): NormalizedGithubEvent {
  const actor = stringValue(payload.sender?.login) ?? null;
  const actorName = actor ?? 'Unknown actor';
  const repository = repositoryName(payload) ?? null;
  const repositoryDisplay = repository ?? 'unknown repository';
  const deploymentPayload = objectValue(payload.deployment?.payload);
  const environment = stringValue(payload.deployment_status?.environment)
    ?? stringValue(payload.deployment?.environment)
    ?? stringValue(deploymentPayload?.environment)
    ?? null;
  const service = stringValue(deploymentPayload?.service)
    ?? stringValue(deploymentPayload?.service_name)
    ?? null;
  const metadata = {
    occurredAt: githubOccurredAt(eventName, payload, ingestedAt),
    environment,
    service,
    repository,
    commitSha: commitSha(eventName, payload),
    deploymentId: identifierValue(payload.deployment?.id)
      ?? identifierValue(payload.deployment_status?.deployment_id)
      ?? null,
    deploymentUrl: stringValue(payload.deployment_status?.target_url)
      ?? stringValue(payload.deployment_status?.environment_url)
      ?? stringValue(payload.deployment?.url)
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
    const action = payload.deleted === true
      ? 'deleted'
      : payload.created === true
        ? 'created'
        : payload.forced === true
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
    const action = payload.pull_request?.merged === true
      ? 'merged'
      : stringValue(payload.action) ?? 'updated';
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
    const state = stringValue(payload.deployment_status?.state) ?? 'updated';
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
    const action = stringValue(payload.action) ?? 'created';
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

  const action = stringValue(payload.action);
  const number = metadata.prNumber ?? numberValue(payload.issue?.number);
  const subject = number ? `${repositoryDisplay}#${number}` : repositoryDisplay;

  return {
    actor,
    eventType: action ? `${eventName}.${action}` : eventName,
    subject,
    summary: `${actorName} ${action ?? 'triggered'} ${eventName} for "${subject}"`,
    ...metadata,
  };
}

export function parseGithubPayload(body: string, contentType?: string) {
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  const payload = mediaType === 'application/x-www-form-urlencoded'
    ? new URLSearchParams(body).get('payload')
    : body;

  if (payload === null) {
    throw new SyntaxError('Missing form field "payload"');
  }

  return JSON.parse(payload);
}
