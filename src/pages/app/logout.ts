import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ cookies }) => {
  cookies.delete('session', { path: '/' });
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  });
};
