#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { query, executeTransaction, isReadonlySQL, getReadonlyMode, closePool } from "./db/pool.js";
import express, { Request, Response } from "express";
import http from "http";

const isReadonly = getReadonlyMode();

if (isReadonly) {
  console.error("Read-only mode: enabled (query only)");
} else {
  console.error("Read-only mode: disabled (all operations allowed)");
}

/** Build a success response */
function success(data: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/** Build an error response */
function fail(msg: string, err: unknown) {
  return success({ msg, error: (err as Error).message });
}

/** Validate table name to prevent SQL injection */
function validateTableName(name: string): string {
  if (!/^[\w\u4e00-\u9fa5]+$/.test(name)) {
    throw new Error(`Invalid table name: ${name}`);
  }
  return name;
}

// Create MCP server
const server = new McpServer({
  name: "mysql-mcp",
  version: "1.0.0",
});

// Tool 1: Execute read-only SQL queries
server.registerTool(
  "sql_query",
  {
    description: "Execute MySQL SELECT queries, supports multiple statements",
    inputSchema: {
      sql: z
        .array(z.string())
        .describe(
          "SQL SELECT statements as an array. Use \\n for line breaks or write as a single line.",
        ),
    },
  },
  async ({ sql }) => {
    // Validate SQL content in read-only mode
    if (isReadonly) {
      const blockedSQLs: { index: number; sql: string }[] = [];
      for (const [index, s] of sql.entries()) {
        if (!isReadonlySQL(s)) {
          blockedSQLs.push({ index: index + 1, sql: s });
        }
      }
      if (blockedSQLs.length > 0) {
        return success({
          msg: "Read-only mode: only SELECT / SHOW / DESCRIBE / EXPLAIN allowed",
          error: "READONLY_SQL_BLOCKED" as unknown,
          blocked: blockedSQLs as unknown,
        });
      }
    }

    const results = [];

    // Execute SQL one by one
    for (const [index, currentSql] of sql.entries()) {
      try {
        const rows = await query(currentSql);
        results.push({
          sql: currentSql,
          result: rows,
          status: "success",
        });
      } catch (err) {
        results.push({
          sql: currentSql,
          error: (err as Error).message,
          status: "failure",
        });
      }
    }

    const hasFailure = results.some((item) => item.status === "failure");

    const responseData = {
      msg: hasFailure ? "Partial query failure" : "Query successful",
      total: results.length,
      success: results.filter((item) => item.status === "success").length,
      failure: results.filter((item) => item.status === "failure").length,
      results: results.map((item, index) => ({
        index: index + 1,
        sql: item.sql,
        status: item.status,
        result: item.status === "success" ? item.result : undefined,
        error: item.status === "failure" ? item.error : undefined,
      })),
    };

    return success(responseData);
  },
);

// Tool 2: List all tables in the current database
server.registerTool(
  "sql_list_tables",
  {
    description: "List all table names in the current MySQL database",
    inputSchema: {},
  },
  async () => {
    try {
      const rows = await query(`SHOW TABLES`);

      const tables = (rows as Record<string, string>[]).map(
        (row) => Object.values(row)[0],
      );

      const responseData = {
        msg: "Table list retrieved",
        total: tables.length,
        tables: tables,
      };

      return success(responseData);
    } catch (err) {
      return fail("Failed to retrieve table list", err);
    }
  },
);

// Tool 3: Get table schema
server.registerTool(
  "sql_table_schema",
  {
    description: "Get the column structure of a MySQL table",
    inputSchema: {
      table: z.string().describe("Table name to inspect"),
    },
  },
  async ({ table }) => {
    try {
      const safeTable = validateTableName(table);
      // Use INFORMATION_SCHEMA to avoid LIKE wildcard issues and SQL injection
      const tableInfoResult = await query(
        `SELECT TABLE_COMMENT FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [safeTable],
      );
      const tableInfo = (tableInfoResult as any[])[0];

      // Use backtick-escaped table name
      const columns = await query(`SHOW FULL COLUMNS FROM \`${safeTable}\``);

      // Normalize column keys to lowercase
      const formattedColumns = (columns as any[]).map((col: any) => {
        const formatted: any = {};
        for (const [key, value] of Object.entries(col)) {
          formatted[key.toLowerCase()] = value;
        }
        return formatted;
      });

      const responseData = {
        msg: "Table schema retrieved",
        table: table,
        tableComment: tableInfo?.TABLE_COMMENT || "",
        columns: formattedColumns,
      };

      return success(responseData);
    } catch (err) {
      return fail("Failed to retrieve table schema", err);
    }
  },
);

// Tool 4: Execute SQL writes (only registered when read-only mode is disabled)
if (!isReadonly) {
  server.registerTool(
    "sql_execute",
    {
      description:
        "Execute MySQL INSERT/UPDATE/DELETE operations within a transaction (automatically rolled back)",
      inputSchema: {
        sql: z
          .array(z.string())
          .describe(
            "SQL statements as an array, supports INSERT, UPDATE, DELETE, SELECT. Use \\n for line breaks or write as a single line.",
          ),
      },
    },
    async ({ sql }) => {
      // Read-only mode internal guard (defense in depth)
      if (isReadonly) {
        return success({ msg: "Read-only mode is enabled, write operations are not allowed", error: "READONLY_MODE" as unknown });
      }

      try {
      const results = await executeTransaction(async (connection) => {
        const executionResults = [];

        // Execute SQL one by one
        for (const [index, currentSql] of sql.entries()) {
          try {
            const [result] = await connection.query(currentSql);

            // Check if result contains data rows (SELECT)
            if (Array.isArray(result)) {
              executionResults.push({
                sql: currentSql,
                result: result,
                status: "success",
              });
            } else {
              // Non-SELECT statements (INSERT, UPDATE, DELETE)
              executionResults.push({
                sql: currentSql,
                affectedRows: (result as any).affectedRows || 0,
                insertId: (result as any).insertId || undefined,
                status: "success",
              });
            }
          } catch (err) {
            executionResults.push({
              sql: currentSql,
              error: (err as Error).message,
              status: "failure",
            });
          }
        }

        return executionResults;
      });

      const hasFailure = results.some((item) => item.status === "failure");

      const responseData = {
        msg: hasFailure ? "Partial execution failure" : "SQL executed (transaction rolled back)",
        note: "Transaction has been rolled back, no changes persisted",
        total: results.length,
        success: results.filter((item) => item.status === "success").length,
        failure: results.filter((item) => item.status === "failure").length,
        results: results.map((item, index) => ({
          index: index + 1,
          sql: item.sql,
          status: item.status,
          result:
            item.status === "success" && item.result ? item.result : undefined,
          affectedRows: item.status === "success" ? item.affectedRows : undefined,
          insertId:
            item.status === "success" && item.insertId ? item.insertId : undefined,
          error: item.status === "failure" ? item.error : undefined,
        })),
      };

      return success(responseData);
    } catch (err) {
      return fail("Execution failed", err);
    }
  },
);
} // if (!isReadonly)

async function main() {
  // // === Streamable HTTP mode ===
  // const app = express();
  // const port = process.env.PORT || 8089;

  // // Configure Streamable HTTP transport
  // const streamableHttpTransport = new StreamableHTTPServerTransport({
  //   // Stateful mode - server generates session ID
  //   sessionIdGenerator: () =>
  //     Math.random().toString(36).substring(2, 15) +
  //     Math.random().toString(36).substring(2, 15),
  // });

  // // Connect server
  // await server.connect(streamableHttpTransport);

  // // Route all MCP requests through /mcp endpoint
  // app.post("/mcp", (req: Request, res: Response) => {
  //   streamableHttpTransport.handleRequest(req, res);
  // });
  // app.get("/mcp", (req: Request, res: Response) => {
  //   streamableHttpTransport.handleRequest(req, res);
  // });

  // // Start HTTP server
  // const httpServer = http.createServer(app);
  // httpServer.listen(port, () => {
  //   console.error(
  //     `MCP Server running on Streamable HTTP at http://localhost:${port}/mcp`,
  //   );
  //   console.error("Supported transports:");
  //   console.error("- POST /mcp: JSON-RPC requests");
  //   console.error("- GET /mcp: SSE streaming");
  // });
  // // Graceful shutdown
  // process.on("SIGINT", async () => {
  //   httpServer.close(() => {
  //     console.error("MCP HTTP server stopped");
  //     process.exit(0);
  //   });
  // });

  // === Stdio mode ===
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  console.error("MCP Server running on stdio");

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.error("Shutting down MCP Server...");
    await closePool();
    console.error("MCP Server stopped");
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error in mysql-mcp main():", error);
  process.exit(1);
});
