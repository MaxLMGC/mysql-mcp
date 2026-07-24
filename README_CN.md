# @maxlmgc/mysql-mcp

> MySQL MCP Server — 为 AI 客户端提供 MySQL 数据库交互能力的 MCP 服务，默认只读安全。

[English](./README.md)

## 功能

| 工具 | 描述 | 只读模式 |
|---|---|---|
| `sql_query` | 执行 SELECT / SHOW / DESCRIBE / EXPLAIN 等查询语句 | 允许 |
| `sql_list_tables` | 获取当前数据库所有表名 | 允许 |
| `sql_table_schema` | 获取指定表的字段结构及注释 | 允许 |
| `sql_execute` | 执行 INSERT / UPDATE / DELETE 等写操作（自动回滚） | 禁止 |

## 环境变量

### 数据库连接（必填）

| 变量 | 说明 | 默认值 |
|---|---|---|
| `MYSQL_HOST` | 数据库地址 | - |
| `MYSQL_PORT` | 数据库端口 | `3306` |
| `MYSQL_USER` | 数据库用户 | - |
| `MYSQL_PASS` | 数据库密码 | 空 |
| `MYSQL_DB` | 数据库名 | - |

### 只读模式

| 变量 | 说明 | 默认值 |
|---|---|---|
| `MYSQL_READONLY` | 设为 `false` 关闭只读模式，允许写操作 | `true`（开启） |
| `MYSQL_READONLY_PREFIXES` | 自定义允许的 SQL 关键字白名单，逗号分隔（覆盖默认值） | `SELECT,SHOW,DESCRIBE,DESC,EXPLAIN,WITH` |

### 连接池

| 变量 | 说明 | 默认值 |
|---|---|---|
| `MYSQL_CONNECTION_LIMIT` | 连接池最大连接数 | `10` |
| `MYSQL_MULTIPLE_STATEMENTS` | 设为 `false` 禁用多语句执行 | `true` |

## 安装

```bash
npm install @maxlmgc/mysql-mcp
```

## 使用

### MCP 客户端配置

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

### 只读模式（默认）

不额外配置即为只读模式，仅允许查询操作，`sql_execute` 工具不会暴露给客户端。

### 关闭只读模式

```json
"env": {
  "MYSQL_HOST": "localhost",
  "MYSQL_USER": "root",
  "MYSQL_DB": "your_database",
  "MYSQL_READONLY": "false"
}
```

### 自定义白名单

仅允许 SELECT 和 SHOW：

```json
"env": {
  "MYSQL_HOST": "localhost",
  "MYSQL_USER": "root",
  "MYSQL_DB": "your_database",
  "MYSQL_READONLY_PREFIXES": "SELECT,SHOW"
}
```

## 开发

```bash
git clone git@github.com:MaxLMGC/mysql-mcp.git
cd mysql-mcp
npm install
npm run dev              # 只读模式（默认）
npm run dev:noreadonly   # 完整权限模式
```

## 安全设计

- **只读默认**：默认仅暴露查询工具，`sql_execute` 不会注册
- **SQL 注入防护**：表名等参数经正则校验，使用参数化查询
- **环境变量校验**：必填项缺失时启动即报错，不会静默失败
- **事务回滚**：`sql_execute` 的所有操作在事务中执行并自动回滚，数据库不会发生实际变更
- **双重拦截**：工具层 + 连接池层均对非只读 SQL 进行拦截

## 许可证

MIT
