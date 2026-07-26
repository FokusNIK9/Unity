import { createServer } from "node:http";
import { readFileSync, promises as fs } from "node:fs";
import path from "node:path";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const widgetUri = "ui://widget/game-builder.html";
const widgetHtml = readFileSync(new URL("./public/widget.html", import.meta.url), "utf8");
const projectRoot = path.resolve(process.env.PROJECT_ROOT ?? process.cwd());

function safeProjectPath(relativePath) {
  const requested = String(relativePath ?? "").trim();
  if (!requested || path.isAbsolute(requested)) {
    throw new Error("A relative project path is required.");
  }
  const resolved = path.resolve(projectRoot, requested);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path is outside the configured project root.");
  }
  return resolved;
}

function createAnalyzerServer() {
  const server = new McpServer({ name: "game-builder", version: "0.2.0" });

  registerAppResource(server, widgetUri, widgetUri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: widgetUri, mimeType: RESOURCE_MIME_TYPE, text: widgetHtml }],
  }));

  registerAppTool(
    server,
    "open_game_builder",
    {
      title: "Открыть Game Builder",
      description: "Открывает интерфейс для генерации игрового кода через ChatGPT.",
      inputSchema: {},
      _meta: { ui: { resourceUri: widgetUri }, "openai/outputTemplate": widgetUri },
    },
    async () => ({
      content: [{ type: "text", text: "Введите объект и его поведение. Кнопка отправит задачу в текущий чат." }],
      structuredContent: { ready: true },
    })
  );

  registerAppTool(
    server,
    "list_project_files",
    {
      title: "Список файлов проекта",
      description: "Показывает файлы только внутри настроенной папки проекта. Используй перед редактированием, чтобы найти нужный файл.",
      inputSchema: { directory: z.string().optional() },
      _meta: { ui: { resourceUri: widgetUri } },
    },
    async ({ directory = "." }) => {
      const target = safeProjectPath(directory);
      const entries = await fs.readdir(target, { withFileTypes: true });
      const files = entries.map((entry) => ({
        path: path.relative(projectRoot, path.join(target, entry.name)).replaceAll("\\", "/"),
        type: entry.isDirectory() ? "directory" : "file",
      }));
      return { content: [{ type: "text", text: JSON.stringify(files) }], structuredContent: { files } };
    }
  );

  registerAppTool(
    server,
    "read_project_file",
    {
      title: "Прочитать файл проекта",
      description: "Читает текстовый файл из настроенной папки проекта.",
      inputSchema: { path: z.string().min(1) },
      _meta: { ui: { resourceUri: widgetUri } },
    },
    async ({ path: relativePath }) => {
      const filePath = safeProjectPath(relativePath);
      const content = await fs.readFile(filePath, "utf8");
      return { content: [{ type: "text", text: content }], structuredContent: { path: relativePath, content } };
    }
  );

  registerAppTool(
    server,
    "write_project_file",
    {
      title: "Записать файл проекта",
      description: "Создаёт или полностью заменяет текстовый файл внутри настроенной папки проекта. Используй только когда пользователь попросил сохранить или обновить код на компьютере. Путь всегда относительный.",
      inputSchema: {
        path: z.string().min(1),
        content: z.string().max(5_000_000),
      },
      _meta: { ui: { resourceUri: widgetUri } },
    },
    async ({ path: relativePath, content }) => {
      const filePath = safeProjectPath(relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
      return {
        content: [{ type: "text", text: `Saved ${relativePath}` }],
        structuredContent: { path: relativePath, bytes: Buffer.byteLength(content, "utf8"), saved: true },
      };
    }
  );

  return server;
}

const port = Number(process.env.PORT ?? 8787);
const mcpPath = "/mcp";

const httpServer = createServer(async (req, res) => {
  if (!req.url) return res.writeHead(400).end("Missing URL");
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS" && url.pathname === mcpPath) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    return res.end();
  }

  if (req.method === "GET" && url.pathname === "/") {
    return res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("Game Builder MCP server");
  }

  if (url.pathname === mcpPath && new Set(["POST", "GET", "DELETE"]).has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    const server = createAnalyzerServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) res.writeHead(500).end("Internal server error");
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, () => console.log(`Game Builder listening on http://localhost:${port}${mcpPath}`));
