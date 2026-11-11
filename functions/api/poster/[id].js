// GET /api/poster/<id>: the poster image for the website.
export async function onRequestGet({ env, params }) {
  const id = String(params.id || '');
  if (!/^[a-f0-9]{32}$/.test(id) || !env.CAL) return new Response('Not found', { status: 404 });
  const { value, metadata } = await env.CAL.getWithMetadata('poster:' + id, { type: 'arrayBuffer' });
  if (!value) return new Response('Not found', { status: 404 });
  return new Response(value, {
    headers: {
      'content-type': (metadata && metadata.type) || 'image/jpeg',
      // a poster never changes once uploaded (a new one gets a new id)
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
