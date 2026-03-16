const Database = require('./node_modules/better-sqlite3');
const db = new Database('data/audiovault.db');
const rows = db.prepare(`
  SELECT record_id, action, status, error_msg, datetime(created_at, 'unixepoch') as time
  FROM processing_log
  ORDER BY created_at DESC
  LIMIT 10
`).all();
console.table(rows);
db.close();
