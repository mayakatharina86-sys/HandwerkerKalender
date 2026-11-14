// Datenbankschema (D1/SQLite). Wird vom Worker beim ersten Zugriff automatisch angelegt (IF NOT EXISTS).
// Die Tabelle "settings" steht bewusst zuletzt: ihre Existenz zeigt, dass alles angelegt ist.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  info TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  is_boss INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  customer TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  work_time TEXT NOT NULL DEFAULT '',
  start_date TEXT,
  status TEXT NOT NULL DEFAULT 'geplant' CHECK (status IN ('geplant','in_bearbeitung','erledigt','problem')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  employee_id INTEGER REFERENCES employees(id),
  site_id INTEGER REFERENCES sites(id),
  text TEXT NOT NULL DEFAULT '',
  color TEXT,
  row_type TEXT NOT NULL DEFAULT 'work' CHECK (row_type IN ('work','extras')),
  sort INTEGER NOT NULL DEFAULT 0
)`,
  `CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date)`,
  `CREATE INDEX IF NOT EXISTS idx_entries_site ON entries(site_id)`,
  `CREATE TABLE IF NOT EXISTS absences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('vacation','sick')),
  UNIQUE (employee_id, date)
)`,
  `CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
)`,
  `CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`,
];
