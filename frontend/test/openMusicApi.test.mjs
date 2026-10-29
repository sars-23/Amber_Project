import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchOpenMusicTracks,
  startOpenMusicImport,
  fetchOpenMusicImportJob,
  fetchActiveOpenMusicJobs,
  retryFailedOpenMusicImport,
  cancelOpenMusicImport,
} from '../src/services/openMusicApi.ts';

describe('Open Music API Service', () => {
  const originalFetch = globalThis.fetch;

  it('rejects API calls when admin key is empty or whitespace', async () => {
    await assert.rejects(
      async () => startOpenMusicImport(['123'], ''),
      /Enter the Amber Admin API Key/
    );

    await assert.rejects(
      async () => fetchOpenMusicImportJob('job-1', '   '),
      /Enter the Amber Admin API Key/
    );

    await assert.rejects(
      async () => retryFailedOpenMusicImport('job-1', ''),
      /Enter the Amber Admin API Key/
    );

    await assert.rejects(
      async () => cancelOpenMusicImport('job-1', ''),
      /Enter the Amber Admin API Key/
    );
  });

  it('searchOpenMusicTracks performs unauthenticated query and returns tracks', async () => {
    let capturedUrl = '';
    globalThis.fetch = async (url) => {
      capturedUrl = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: '101',
            title: 'Sample Track',
            artist: 'Sample Artist',
            album: 'Sample Album',
            durationSeconds: 120,
            sourceUrl: 'https://jamendo.com/track/101',
            licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
            licenseName: 'CC BY',
            attributionText: 'Sample Artist - Sample Track',
          },
        ],
      };
    };

    try {
      const results = await searchOpenMusicTracks('jazz chill', 15);
      assert.equal(results.length, 1);
      assert.equal(results[0].title, 'Sample Track');
      assert.match(capturedUrl, /\/open-music\/search\?q=jazz%20chill&limit=15/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('startOpenMusicImport sends X-Amber-Admin-Key header and JSON payload', async () => {
    let capturedHeaders = {};
    let capturedBody = '';
    globalThis.fetch = async (url, options) => {
      capturedHeaders = options.headers;
      capturedBody = options.body;
      return {
        ok: true,
        status: 202,
        json: async () => ({
          id: 'mock-uuid',
          status: 'QUEUED',
          total: 2,
          queued: 2,
          processing: 0,
          imported: 0,
          skipped: 0,
          failed: 0,
          cancelled: 0,
          items: [],
        }),
      };
    };

    try {
      const job = await startOpenMusicImport(['101', '102'], 'my-admin-key');
      assert.equal(job.id, 'mock-uuid');
      assert.equal(capturedHeaders['X-Amber-Admin-Key'], 'my-admin-key');
      assert.equal(capturedHeaders['Content-Type'], 'application/json');
      assert.deepEqual(JSON.parse(capturedBody), { trackIds: ['101', '102'] });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('translates HTTP 401 and 403 into clear authorization errors', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthorized' }),
    });

    try {
      await assert.rejects(
        async () => fetchActiveOpenMusicJobs('wrong-key'),
        /Amber admin authorization is required/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    globalThis.fetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ message: 'Invalid administrative credentials.' }),
    });

    try {
      await assert.rejects(
        async () => cancelOpenMusicImport('job-1', 'wrong-key'),
        /Invalid administrative credentials/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    globalThis.fetch = async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
    });

    try {
      await assert.rejects(
        async () => searchOpenMusicTracks('piano'),
        /Search rate limit reached/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
