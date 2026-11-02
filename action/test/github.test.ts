import { describe, expect, it } from 'vitest';
import { GitHubError, upsertComment } from '../github.mjs';

const MARKER = '<!-- kgdiff-action: Graph diff/kgdiff-report -->';

interface Comment {
  id: number;
  body: string;
  user: { login: string; type: 'User' | 'Bot' };
}

/** A fake GitHub API for one pull request (#7 in o/r), recording the requests it serves. */
function fakeGitHub(options: {
  comments?: Comment[];
  self?: string;
  fail?: Record<string, number>;
}) {
  const comments = [...(options.comments ?? [])];
  const requests: string[] = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const route = `${method} ${url.pathname}`;
    requests.push(`${route}${url.search}`);
    const status = options.fail?.[route];
    if (status) return json(status, { message: 'Resource not accessible by integration' });
    if (route === 'GET /user') {
      return options.self ? json(200, { login: options.self }) : json(403, { message: 'nope' });
    }
    if (route === 'GET /repos/o/r/issues/7/comments') {
      const page = Number(url.searchParams.get('page'));
      const size = Number(url.searchParams.get('per_page'));
      return json(200, comments.slice((page - 1) * size, page * size));
    }
    const body = JSON.parse(String(init?.body ?? '{}')).body as string;
    const edit = /^PATCH \/repos\/o\/r\/issues\/comments\/(\d+)$/.exec(route);
    if (edit) {
      const comment = comments.find((c) => c.id === Number(edit[1]));
      if (!comment) return json(404, { message: 'Not Found' });
      comment.body = body;
      return json(200, { html_url: `https://github.com/o/r/pull/7#issuecomment-${comment.id}` });
    }
    if (route === 'POST /repos/o/r/issues/7/comments') {
      const id = 1000 + comments.length;
      comments.push({
        id,
        body,
        user: { login: options.self ?? 'github-actions[bot]', type: 'Bot' },
      });
      return json(201, { html_url: `https://github.com/o/r/pull/7#issuecomment-${id}` });
    }
    return json(404, { message: 'Not Found' });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests, comments };
}

const options = (fetch: typeof globalThis.fetch, create = true) => ({
  apiUrl: 'https://api.github.com/',
  token: 'token',
  repository: 'o/r',
  issue: 7,
  marker: MARKER,
  body: `${MARKER}\n\nnew`,
  create,
  fetch,
  retryDelay: 0,
});

describe('upsertComment', () => {
  it('creates a comment when there is none', async () => {
    const api = fakeGitHub({});
    const result = await upsertComment(options(api.fetch));
    expect(result).toEqual({
      action: 'created',
      url: 'https://github.com/o/r/pull/7#issuecomment-1000',
    });
    expect(api.requests).toEqual([
      'GET /user',
      'GET /repos/o/r/issues/7/comments?per_page=100&page=1',
      'POST /repos/o/r/issues/7/comments',
    ]);
  });

  it('updates the bot comment with the marker in place, not a human comment quoting it', async () => {
    const api = fakeGitHub({
      comments: [
        { id: 1, body: `${MARKER}\n\nforged`, user: { login: 'someone', type: 'User' } },
        { id: 2, body: 'unrelated', user: { login: 'github-actions[bot]', type: 'Bot' } },
        { id: 3, body: `${MARKER}\n\nold`, user: { login: 'github-actions[bot]', type: 'Bot' } },
      ],
    });
    const result = await upsertComment(options(api.fetch));
    expect(result.action).toBe('updated');
    expect(api.requests.at(-1)).toBe('PATCH /repos/o/r/issues/comments/3');
    expect(api.comments.map((c) => c.body)).toEqual([
      `${MARKER}\n\nforged`,
      'unrelated',
      `${MARKER}\n\nnew`,
    ]);
  });

  it("with a personal token, updates that account's comment", async () => {
    const api = fakeGitHub({
      self: 'maintainer',
      comments: [
        { id: 1, body: `${MARKER}\n\nbot`, user: { login: 'github-actions[bot]', type: 'Bot' } },
        { id: 2, body: `${MARKER}\n\nmine`, user: { login: 'maintainer', type: 'User' } },
      ],
    });
    await upsertComment(options(api.fetch));
    expect(api.requests.at(-1)).toBe('PATCH /repos/o/r/issues/comments/2');
  });

  it('finds the comment on a later page', async () => {
    const filler = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      body: `comment ${i}`,
      user: { login: 'someone', type: 'User' as const },
    }));
    const api = fakeGitHub({
      comments: [
        ...filler,
        { id: 500, body: MARKER, user: { login: 'github-actions[bot]', type: 'Bot' } },
      ],
    });
    await upsertComment(options(api.fetch));
    expect(api.requests).toContain('GET /repos/o/r/issues/7/comments?per_page=100&page=2');
    expect(api.requests.at(-1)).toBe('PATCH /repos/o/r/issues/comments/500');
  });

  it('does not create a comment when asked to update only', async () => {
    const api = fakeGitHub({});
    expect(await upsertComment(options(api.fetch, false))).toEqual({ action: 'skipped' });
    expect(api.requests.some((r) => r.startsWith('POST'))).toBe(false);
  });

  it('writes a new comment when the old one cannot be edited', async () => {
    const api = fakeGitHub({
      comments: [{ id: 3, body: MARKER, user: { login: 'other-app[bot]', type: 'Bot' } }],
      fail: { 'PATCH /repos/o/r/issues/comments/3': 403 },
    });
    expect((await upsertComment(options(api.fetch))).action).toBe('created');
  });

  it('retries server errors, then reports the failure', async () => {
    let calls = 0;
    const flaky = (async () => {
      calls++;
      return new Response('{}', { status: 502 });
    }) as typeof globalThis.fetch;
    const error = await upsertComment(options(flaky)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).status).toBe(502);
    expect(calls).toBe(3);
  });

  it('reports a read-only token as HTTP 403', async () => {
    const api = fakeGitHub({ fail: { 'POST /repos/o/r/issues/7/comments': 403 } });
    const error = await upsertComment(options(api.fetch)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).status).toBe(403);
    expect((error as GitHubError).message).toBe(
      'POST /repos/o/r/issues/7/comments: HTTP 403: Resource not accessible by integration',
    );
  });
});
