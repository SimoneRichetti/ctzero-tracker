import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError, createThrottle, isFatalHttpError, requestJson } from './http';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('requestJson', () => {
  it('returns the JSON', async () => {
    fetchMock.mockResolvedValueOnce(json({ a: 1 }));
    await expect(requestJson('https://x.test/a')).resolves.toEqual({ a: 1 });
  });

  it('retries on 429 and then succeeds', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(json({ ok: true }));
    await expect(requestJson('https://x.test/a', { retryDelayMs: 1 })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws HttpError after retries on 500', async () => {
    fetchMock.mockImplementation(async () => json({ e: 1 }, 500));
    const err = await requestJson('https://x.test/a', { retryDelayMs: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry on 404', async () => {
    fetchMock.mockImplementation(async () => json({}, 404));
    const err = (await requestJson('https://x.test/a', { retryDelayMs: 1 }).catch((e: unknown) => e)) as HttpError;
    expect(err.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('on network error retries and then throws HttpError with status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const err = (await requestJson('https://x.test/a', { retryDelayMs: 1 }).catch((e: unknown) => e)) as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not put path and query in the error message (no tokens)', async () => {
    fetchMock.mockImplementation(async () => json({}, 401));
    const err = (await requestJson('https://api.telegram.org/botSECRET/sendMessage?x=SECRET').catch(
      (e: unknown) => e,
    )) as HttpError;
    expect(err.message).toContain('api.telegram.org');
    expect(err.message).not.toContain('SECRET');
  });

  it('sends the JSON body on POST', async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await requestJson('https://x.test/a', { method: 'POST', body: { a: 1 } });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});

describe('isFatalHttpError', () => {
  it('recognizes 401 and 403', () => {
    expect(isFatalHttpError(new HttpError(401, 'x'))).toBe(true);
    expect(isFatalHttpError(new HttpError(403, 'x'))).toBe(true);
    expect(isFatalHttpError(new HttpError(500, 'x'))).toBe(false);
    expect(isFatalHttpError(new Error('x'))).toBe(false);
  });
});

describe('createThrottle', () => {
  it('spaces out calls', async () => {
    const throttle = createThrottle(40);
    const start = Date.now();
    await throttle();
    await throttle();
    await throttle();
    expect(Date.now() - start).toBeGreaterThanOrEqual(75);
  });
});
