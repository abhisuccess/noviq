const { json } = require('./_shared');

module.exports = function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  return json(res, 200, {
    models: [process.env.GEMINI_MODEL || 'gemini-3.6-flash']
  });
};
