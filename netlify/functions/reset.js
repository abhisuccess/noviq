const { store, hash, getDeviceId, json } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const data = JSON.parse(event.body || '{}');
    const sessionId = String(data.session_id || 'default');
    const deviceId = getDeviceId(event);
    await store.delete(`history-${hash(`${deviceId}:${sessionId}`)}`);
    return json(200, { status: 'success' });
  } catch (error) {
    console.error(error);
    return json(400, { error: 'Invalid request body.' });
  }
};
