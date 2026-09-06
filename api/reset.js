const { json, getDeviceId, deleteHistory } = require('./_shared');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const data = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    await deleteHistory(getDeviceId(req), String(data.session_id || 'default'));
    return json(res, 200, { status: 'success' });
  } catch (error) {
    console.error(error);
    return json(res, 400, { error: error.message || 'Invalid request body.' });
  }
};
