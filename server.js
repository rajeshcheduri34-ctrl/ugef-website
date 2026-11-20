const http = require('http');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HTTP_PORT = 80;
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'index.html'))
  ? __dirname
  : path.join(__dirname, 'UGEF_Full_Source_Code');
const DB_FILE = path.join(__dirname, 'ugef_database.sqlite');

// Initialize SQLite database
const db = new DatabaseSync(DB_FILE);

// Create table if not exists
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

// Prepared statements
const insertContact = db.prepare(`
  INSERT INTO contacts (name, email, subject, message, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

const getAllContacts = db.prepare(`
  SELECT id, name, email, subject, message, created_at
  FROM contacts
  ORDER BY id DESC
`);

const getContactById = db.prepare(`
  SELECT id, name, email, subject, message, created_at
  FROM contacts
  WHERE id = ?
`);

const deleteContactById = db.prepare(`
  DELETE FROM contacts
  WHERE id = ?
`);

const countContacts = db.prepare(`
  SELECT COUNT(*) as total FROM contacts
`);

// MIME types dictionary
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8',
};

// Helper: parse incoming JSON request body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) { // 1MB limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (err) {
        reject(new Error('Invalid JSON format'));
      }
    });
    req.on('error', reject);
  });
}

// Helper: send JSON response
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

// Main request handler
const appHandler = async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'ugef.org'}`);
  const pathname = decodeURI(urlObj.pathname);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // --- API Endpoints ---
  if (pathname === '/api/contact' || pathname === '/api/contacts') {
    if (req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const name = (body.name || '').trim();
        const email = (body.email || '').trim();
        const subject = (body.subject || '').trim();
        const message = (body.message || '').trim();

        if (!name || !email || !message) {
          return sendJson(res, 400, {
            success: false,
            error: 'Name, email, and message are required fields.'
          });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return sendJson(res, 400, {
            success: false,
            error: 'Please provide a valid email address.'
          });
        }

        const createdAt = new Date().toISOString();
        const result = insertContact.run(name, email, subject, message, createdAt);

        return sendJson(res, 201, {
          success: true,
          message: 'Thank you! Your message has been saved successfully.',
          id: result.lastInsertRowid,
          data: { id: result.lastInsertRowid, name, email, subject, message, created_at: createdAt }
        });
      } catch (err) {
        console.error('Error handling POST /api/contact:', err);
        return sendJson(res, 500, { success: false, error: err.message || 'Server error' });
      }
    }

    if (req.method === 'GET') {
      try {
        const rows = getAllContacts.all();
        return sendJson(res, 200, {
          success: true,
          count: rows.length,
          data: rows
        });
      } catch (err) {
        console.error('Error handling GET /api/contacts:', err);
        return sendJson(res, 500, { success: false, error: 'Failed to retrieve contacts' });
      }
    }
  }

  // DELETE /api/contacts/:id
  if (pathname.startsWith('/api/contacts/') && req.method === 'DELETE') {
    const id = parseInt(pathname.replace('/api/contacts/', ''), 10);
    if (!id || isNaN(id)) {
      return sendJson(res, 400, { success: false, error: 'Invalid ID' });
    }
    try {
      const existing = getContactById.get(id);
      if (!existing) {
        return sendJson(res, 404, { success: false, error: 'Entry not found' });
      }
      deleteContactById.run(id);
      return sendJson(res, 200, { success: true, message: 'Deleted successfully', id });
    } catch (err) {
      console.error('Error handling DELETE /api/contacts/:id:', err);
      return sendJson(res, 500, { success: false, error: 'Failed to delete record' });
    }
  }

  // GET /api/contacts/export - Export all records to CSV
  if (pathname === '/api/contacts/export' && req.method === 'GET') {
    try {
      const rows = getAllContacts.all();
      let csv = 'ID,Name,Email,Subject,Message,Created At\r\n';
      for (const row of rows) {
        const escapeCsv = (str) => `"${(str || '').replace(/"/g, '""')}"`;
        csv += `${row.id},${escapeCsv(row.name)},${escapeCsv(row.email)},${escapeCsv(row.subject)},${escapeCsv(row.message)},${escapeCsv(row.created_at)}\r\n`;
      }
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="ugef_contacts.csv"',
      });
      return res.end(csv);
    } catch (err) {
      console.error('Error generating CSV:', err);
      return sendJson(res, 500, { success: false, error: 'Failed to generate CSV' });
    }
  }

  // GET /api/stats
  if (pathname === '/api/stats' && req.method === 'GET') {
    try {
      const count = countContacts.get().total;
      return sendJson(res, 200, { success: true, total: count });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: 'Failed to get stats' });
    }
  }

  // --- Static File Serving ---
  let reqPath = pathname;
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

  let filePath = path.join(PUBLIC_DIR, reqPath);

  // If path is a directory, look for index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('403 Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
};

// Start server on Port 3000
const server3000 = http.createServer(appHandler);
server3000.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening at http://localhost:${PORT}/ and http://ugef.org:${PORT}/`);
  console.log(`Database connected: ${DB_FILE}`);
});

// Also start server on Port 80 (standard HTTP port so :3000 is not needed)
const server80 = http.createServer(appHandler);
server80.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`Server also listening on port 80 at http://ugef.org/ and http://localhost/`);
});
server80.on('error', (err) => {
  console.log(`Note: Port 80 binding (${err.message}). Port ${PORT} is active.`);
});
