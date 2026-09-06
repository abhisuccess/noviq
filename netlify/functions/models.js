const { json } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  return json(200, {
    models: [process.env.GEMINI_MODEL || 'gemini-3.6-flash']
  });
};
