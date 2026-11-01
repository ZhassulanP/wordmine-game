import { api } from '../src/api.js';
import { createPostgresStore } from '../src/postgres-store.js';

let store;
export default {
  async fetch(request) {
    if (!process.env.DATABASE_URL) {
      return Response.json({ error: 'Хранилище комнат ещё не подключено.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    store ??= createPostgresStore(process.env.DATABASE_URL);
    const url = new URL(request.url);
    if (url.searchParams.has('route')) {
      url.pathname = '/api/' + url.searchParams.get('route');
      url.searchParams.delete('route');
      request = new Request(url, request);
    }
    return api(request, store);
  }
};
