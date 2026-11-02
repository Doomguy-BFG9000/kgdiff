// @ts-check
/**
 * The action's pull request comment, through the GitHub REST API: find the comment an earlier
 * run left (by its hidden marker, among the comments of the token's own account), update it in
 * place, or create one. `fetch` is injectable for tests.
 */

/** A failed GitHub API request; `status` is 0 when no response arrived. */
export class GitHubError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   */
  constructor(status, message) {
    super(message);
    this.name = 'GitHubError';
    /** @readonly */
    this.status = status;
  }
}

/**
 * @typedef {object} ApiOptions
 * @property {string} apiUrl `GITHUB_API_URL`, e.g. https://api.github.com
 * @property {string} token
 * @property {typeof fetch} [fetch]
 * @property {number} [retryDelay] Milliseconds before the first retry of a failed request.
 */

/** @typedef {(method: string, path: string, body?: unknown) => Promise<any>} Request */

/**
 * A REST client that retries network errors and 5xx responses twice.
 *
 * @param {ApiOptions} options
 * @returns {Request}
 */
function client({ apiUrl, token, fetch: send = fetch, retryDelay = 1000 }) {
  const base = apiUrl.replace(/\/+$/, '');
  return async (method, path, body) => {
    for (let attempt = 0; ; attempt++) {
      const retry = attempt < 2;
      /** @type {Response} */
      let response;
      try {
        response = await send(`${base}${path}`, {
          method,
          headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'user-agent': 'kgdiff-action',
            'x-github-api-version': '2022-11-28',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (error) {
        if (retry) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay * 3 ** attempt));
          continue;
        }
        const reason = error instanceof Error ? error.message : String(error);
        throw new GitHubError(0, `${method} ${path} failed: ${reason}`);
      }
      if (response.status >= 500 && retry) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay * 3 ** attempt));
        continue;
      }
      if (!response.ok) {
        /** @type {string} */
        let detail = '';
        try {
          const json = /** @type {{ message?: unknown }} */ (await response.json());
          if (typeof json.message === 'string') detail = `: ${json.message}`;
        } catch {
          // No JSON body.
        }
        throw new GitHubError(
          response.status,
          `${method} ${path}: HTTP ${response.status}${detail}`,
        );
      }
      return response.status === 204 ? undefined : response.json();
    }
  };
}

/**
 * The login of the token's account, or `undefined` for a GitHub App installation token such as
 * the workflow's `GITHUB_TOKEN`, which cannot read `/user`.
 *
 * @param {Request} request
 */
async function selfLogin(request) {
  try {
    const user = await request('GET', '/user');
    return typeof user?.login === 'string' ? /** @type {string} */ (user.login) : undefined;
  } catch (error) {
    if (error instanceof GitHubError && [401, 403, 404].includes(error.status)) return undefined;
    throw error;
  }
}

/**
 * @typedef {object} CommentOptions
 * @property {string} repository `owner/name`
 * @property {number} issue The pull request number.
 * @property {string} marker The hidden first line that identifies the comment.
 * @property {string} body The whole comment; starts with `marker`.
 * @property {boolean} create Create a comment when none exists yet (else only update).
 */

/**
 * Update the comment that starts with `marker` and was written by the token's account (or,
 * when that account cannot be known, by a bot), or create one.
 *
 * @param {ApiOptions & CommentOptions} options
 * @returns {Promise<{ action: 'created' | 'updated' | 'skipped', url?: string }>}
 */
export async function upsertComment(options) {
  const request = client(options);
  const { repository, issue, marker, body } = options;
  const self = await selfLogin(request);
  /** @type {{ id: number } | undefined} */
  let existing;
  for (let page = 1; !existing; page++) {
    const comments = await request(
      'GET',
      `/repos/${repository}/issues/${issue}/comments?per_page=100&page=${page}`,
    );
    if (!Array.isArray(comments)) break;
    existing = comments.find(
      (c) =>
        typeof c?.body === 'string' &&
        c.body.startsWith(marker) &&
        (self ? c.user?.login === self : c.user?.type === 'Bot'),
    );
    if (comments.length < 100) break;
  }
  if (existing) {
    try {
      const updated = await request(
        'PATCH',
        `/repos/${repository}/issues/comments/${existing.id}`,
        { body },
      );
      return { action: 'updated', url: updated?.html_url };
    } catch (error) {
      // A comment this token may not edit (another account's): leave it, write a new one.
      if (!(error instanceof GitHubError) || ![403, 404, 422].includes(error.status)) throw error;
    }
  }
  if (!options.create) return { action: 'skipped' };
  const created = await request('POST', `/repos/${repository}/issues/${issue}/comments`, {
    body,
  });
  return { action: 'created', url: created?.html_url };
}
