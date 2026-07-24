# @maxlmgc/mysql-mcp

> MySQL MCP Server — a secure, read-only-by-default MySQL integration for AI clients via the Model Context Protocol.

[中文文档](./README_CN.md)

## Tools

| Tool | Description | Read-only mode |
|---|---|---|
| `sql_query` | Execute SELECT / SHOW / DESCRIBE / EXPLAIN queries | Allowed |
| `sql_list_tables` | List all tables in the current database | Allowed |
| `sql_table_schema` | Get column structure and comments of a table | Allowed |
| `sql_execute` | Execute INSERT / UPDATE / DELETE (auto-rolled back) | Blocked |

## Environment Variables

### Database Connection (required)

| Variable | Description | Default |
|---|---|---|
| `MYSQL_HOST` | Database host | - |
| `MYSQL_PORT` | Database port | `3306` |
| `MYSQL_USER` | Database user | - |
| `MYSQL_PASS` | Database password | (empty) |
| `MYSQL_DB` | Database name | - |

### Read-only Mode

| Variable | Description | Default |
|---|---|---|
| `MYSQL_READONLY` | Set to `false` to disable read-only mode | `true` (enabled) |
| `MYSQL_READONLY_PREFIXES` | Custom SQL keyword whitelist (comma-separated, overrides defaults) | `SELECT,SHOW,DESCRIBE,DESC,EXPLAIN,WITH` |

### Connection Pool

| Variable | Description | Default |
|---|---|---|
| `MYSQL_CONNECTION_LIMIT` | Max connections in pool | `10` |
| `MYSQL_MULTIPLE_STATEMENTS` | Set to `false` to disable multi-statement execution | `true` |

## Installation

```bash
npm install @maxlmgc/mysql-mcp
```

## Usage

### MCP Client Configuration

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "mysql-mcp": {
      "command": "npx",
      "args": ["-y", "@maxlmgc/mysql-mcp"],
      "env": {
        "MYSQL_HOST": "localhost",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "root",
        "MYSQL_PASS": "your_password",
        "MYSQL_DB": "your_database"
      }
    }
  }
}
```

### Read-only Mode (default)

By default only query operations are allowed; `sql_execute` is not exposed.

### Disable Read-only Mode

```json
"env": {
  "MYSQL_HOST": "localhost",
  "MYSQL_USER": "root",
  "MYSQL_DB": "your_database",
  "MYSQL_READONLY": "false"
}
```

### Custom Whitelist

Only allow SELECT and SHOW:

```json
"env": {
  "MYSQL_HOST": "localhost",
  "MYSQL_USER": "root",
  "MYSQL_DB": "your_database",
  "MYSQL_READONLY_PREFIXES": "SELECT,SHOW"
}
```

## Development

```bash
git clone git@github.com:MaxLMGC/mysql-mcp.git
cd mysql-mcp
npm install
npm run dev              # read-only mode (default)
npm run dev:noreadonly   # full access mode
```

## Security

- **Read-only by default**: `sql_execute` is not registered in read-only mode
- **SQL injection prevention**: Table names validated with regex; parameterized queries used
- **Startup validation**: Missing required env vars cause immediate failure
- **Transaction rollback**: `sql_execute` runs in a transaction that is always rolled back
- **Dual-layer protection**: SQL validation at both tool layer and connection pool layer

## License

MIT
