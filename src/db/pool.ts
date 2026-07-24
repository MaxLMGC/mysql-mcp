import mysql from "mysql2/promise";

// Read-only SQL keyword whitelist: customizable via MYSQL_READONLY_PREFIXES env var (comma-separated), overrides defaults
const DEFAULT_READONLY_SQL_PREFIXES = [
  "SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "WITH",
];

const READONLY_SQL_PREFIXES: string[] = process.env.MYSQL_READONLY_PREFIXES
  ? process.env.MYSQL_READONLY_PREFIXES.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
  : DEFAULT_READONLY_SQL_PREFIXES;

/** Check if a SQL statement is read-only (strips comments, matches against whitelist prefixes) */
export function isReadonlySQL(sql: string): boolean {
  const trimmed = sql.trim().toUpperCase();
  const cleaned = trimmed
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
  return READONLY_SQL_PREFIXES.some((prefix) => cleaned.startsWith(prefix));
}

/** Get current read-only mode status */
export function getReadonlyMode(): boolean {
  return !(process.env.MYSQL_READONLY === "false" || process.env.MYSQL_READONLY === "0");
}

// Validate required database environment variables
function validateEnv(): void {
  const required = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_DB"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

validateEnv();

// Create database connection pool
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT, 10) : 3306,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASS || "",
  database: process.env.MYSQL_DB,
  waitForConnections: true,
  connectionLimit: process.env.MYSQL_CONNECTION_LIMIT ? parseInt(process.env.MYSQL_CONNECTION_LIMIT, 10) : 10,
  queueLimit: 0,
  multipleStatements: process.env.MYSQL_MULTIPLE_STATEMENTS === "false" ? false : true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

// Get a database connection from the pool
export async function getConnection() {
  return await pool.getConnection();
}

// Execute a query
export async function query(sql: string, params?: any[]) {
  // Block write operations in read-only mode
  if (getReadonlyMode() && !isReadonlySQL(sql)) {
    throw new Error(
      `Read-only mode is enabled, write operations are not allowed: ${sql.substring(0, 100)}`,
    );
  }
  const connection = await getConnection();
  try {
    const [rows] = await connection.query(sql, params);
    return rows;
  } finally {
    connection.release();
  }
}

// Execute within a transaction (always rolled back for safety)
export async function executeTransaction<T>(
  callback: (connection: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  const connection = await getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.rollback(); // always rollback
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error("Rollback failed:", rollbackError);
    }
    throw error;
  } finally {
    connection.release();
  }
}

// Close the connection pool
export async function closePool() {
  await pool.end();
}

export default pool;
