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
const ignoredDirectories = new Set([".git", "Library", "Temp", "Logs", "obj", "bin", "node_modules"]);

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

async function walk(directory, extensions, maxFiles = 500) {
  const output = [];
  async function visit(current) {
    if (output.length >= maxFiles) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (output.length >= maxFiles) break;
      if (entry.name.startsWith(".") && entry.name !== ".cs") continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(absolute);
      } else if (extensions.has(path.extname(entry.name).toLowerCase())) {
        output.push(absolute);
      }
    }
  }
  await visit(directory);
  return output;
}

function parseCSharp(relativePath, source) {
  const classMatch = source.match(/\b(?:public\s+|internal\s+|private\s+|protected\s+|abstract\s+|sealed\s+|partial\s+)*class\s+(\w+)(?:\s*:\s*([^\n{]+))?/);
  if (!classMatch) return null;

  const name = classMatch[1];
  const inheritance = (classMatch[2] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const methods = [];
  const methodRegex = /\b(public|private|protected|internal)\s+(?:static\s+|virtual\s+|override\s+|async\s+|sealed\s+|new\s+)*(?:[\w<>,.?\[\]]+)\s+(\w+)\s*\(([^)]*)\)/g;
  for (const match of source.matchAll(methodRegex)) {
    const params = match[3]
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    methods.push({ visibility: match[1], name: match[2], parameters: params });
  }

  const fields = [];
  const fieldRegex = /\b(public|private|protected|internal)\s+(?:static\s+|readonly\s+|const\s+|\[SerializeField\]\s+)*([\w<>,.?\[\]]+)\s+(\w+)\s*(?:=|;)/g;
  for (const match of source.matchAll(fieldRegex)) {
    fields.push({ visibility: match[1], type: match[2], name: match[3] });
  }

  const dependencies = new Set(inheritance);
  for (const match of source.matchAll(/\b(?:GetComponent|FindObjectOfType|FindFirstObjectByType|GetComponentInChildren|GetComponentInParent)\s*<\s*(\w+)\s*>/g)) {
    dependencies.add(match[1]);
  }
  for (const field of fields) {
    if (/^[A-Z]/.test(field.type) && !["String", "Vector2", "Vector3", "Quaternion", "GameObject", "Transform"].includes(field.type)) {
      dependencies.add(field.type.replace(/[?\[\]]/g, ""));
    }
  }

  const network = [];
  if (/\[(?:ServerRpc|Command)\]/.test(source)) network.push("client-to-server");
  if (/\[(?:ClientRpc|TargetRpc)\]/.test(source)) network.push("server-to-client");
  if (/NetworkVariable|SyncVar|NetworkBehaviour/.test(source)) network.push("synchronized-state");

  return {
    id: relativePath,
    name,
    path: relativePath,
    kind: inheritance.some((value) => /MonoBehaviour|NetworkBehaviour/.test(value)) ? "component" : "class",
    inherits: inheritance,
    fields,
    methods,
    dependencies: [...dependencies].filter((value) => value !== name),
    network,
  };
}

async function analyzeProject(directory = ".") {
  const target = safeProjectPath(directory);
  const files = await walk(target, new Set([".cs"]));
  const nodes = [];
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    const relativePath = path.relative(projectRoot, file).replaceAll("\\", "/");
    const parsed = parseCSharp(relativePath, source);
    if (parsed) nodes.push(parsed);
  }

  const nameToId = new Map(nodes.map((node) => [node.name, node.id]));
  const edges = [];
  for (const node of nodes) {
    for (const dependency of node.dependencies) {
      const targetId = nameToId.get(dependency);
      if (targetId) edges.push({ from: node.id, to: targetId, type: "dependency", label: dependency });
    }
    for (const networkType of node.network) {
      edges.push({ from: node.id, to: `network:${networkType}`, type: "network", label: networkType });
    }
  }

  const networkNodes = [...new Set(edges.filter((edge) => edge.type === "network").map((edge) => edge.to))]
    .map((id) => ({ id, name: id.split(":")[1], path: "Network", kind: "network", inherits: [], fields: [], methods: [], dependencies: [], network: [] }));

  return { root: projectRoot, scannedDirectory: directory, nodes: [...nodes, ...networkNodes], edges, filesScanned: files.length };
}

function createAnalyzerServer() {
  const server = new McpServer({ name: "game-builder", version: "0.3.0" });

  registerAppResource(server, widgetUri, widgetUri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: widgetUri, mimeType: RESOURCE_MIME_TYPE, text: widgetHtml }],
  }));

  registerAppTool(server, "open_game_builder", {
    title: "Открыть Visual Game Builder",
    description: "Открывает визуальный конструктор объектов, компонентов, методов и зависимостей проекта.",
    inputSchema: {},
    _meta: { ui: { resourceUri: widgetUri }, "openai/outputTemplate": widgetUri },
  }, async () => ({
    content: [{ type: "text", text: "Visual Game Builder готов. Можно описать объект или просканировать Unity-проект." }],
    structuredContent: { ready: true, projectRoot },
  }));

  registerAppTool(server, "analyze_project_architecture", {
    title: "Анализ архитектуры проекта",
    description: "Сканирует C#-файлы Unity-проекта и строит список классов, методов, полей, зависимостей и сетевых связей.",
    inputSchema: { directory: z.string().optional() },
    _meta: { ui: { resourceUri: widgetUri } },
  }, async ({ directory = "." }) => {
    const graph = await analyzeProject(directory);
    return {
      content: [{ type: "text", text: `Проанализировано файлов: ${graph.filesScanned}; объектов: ${graph.nodes.length}.` }],
      structuredContent: { graph },
    };
  });

  registerAppTool(server, "list_project_files", {
    title: "Список файлов проекта",
    description: "Показывает файлы только внутри настроенной папки проекта.",
    inputSchema: { directory: z.string().optional() },
    _meta: { ui: { resourceUri: widgetUri } },
  }, async ({ directory = "." }) => {
    const target = safeProjectPath(directory);
    const entries = await fs.readdir(target, { withFileTypes: true });
    const files = entries.map((entry) => ({
      path: path.relative(projectRoot, path.join(target, entry.name)).replaceAll("\\", "/"),
      type: entry.isDirectory() ? "directory" : "file",
    }));
    return { content: [{ type: "text", text: JSON.stringify(files) }], structuredContent: { files } };
  });

  registerAppTool(server, "read_project_file", {
    title: "Прочитать файл проекта",
    description: "Читает текстовый файл из настроенной папки проекта.",
    inputSchema: { path: z.string().min(1) },
    _meta: { ui: { resourceUri: widgetUri } },
  }, async ({ path: relativePath }) => {
    const filePath = safeProjectPath(relativePath);
    const content = await fs.readFile(filePath, "utf8");
    return { content: [{ type: "text", text: content }], structuredContent: { path: relativePath, content } };
  });

  registerAppTool(server, "write_project_file", {
    title: "Записать файл проекта",
    description: "Создаёт или полностью заменяет текстовый файл внутри настроенной папки проекта. Используй только по явной просьбе пользователя.",
    inputSchema: { path: z.string().min(1), content: z.string().max(5_000_000) },
    _meta: { ui: { resourceUri: widgetUri } },
  }, async ({ path: relativePath, content }) => {
    const filePath = safeProjectPath(relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
    return {
      content: [{ type: "text", text: `Saved ${relativePath}` }],
      structuredContent: { path: relativePath, bytes: Buffer.byteLength(content, "utf8"), saved: true },
    };
  });

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
    return res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("Visual Game Builder MCP server");
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

httpServer.listen(port, () => console.log(`Visual Game Builder listening on http://localhost:${port}${mcpPath}`));