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
const ignoredDirectories = new Set([
  ".git",
  ".game-builder-backups",
  "Library",
  "Temp",
  "Logs",
  "obj",
  "bin",
  "node_modules",
]);

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

function toProjectPath(absolutePath) {
  return path.relative(projectRoot, absolutePath).replaceAll("\\", "/");
}

async function walk(directory, extensions, maxFiles = 2000) {
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
    const relativePath = toProjectPath(file);
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

  return {
    root: projectRoot,
    scannedDirectory: directory,
    nodes: [...nodes, ...networkNodes],
    edges,
    filesScanned: files.length,
  };
}

function isValidCSharpIdentifier(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function consumeQuoted(source, start, prefixLength, quote, verbatim = false) {
  let index = start + prefixLength + 1;
  while (index < source.length) {
    if (verbatim && source[index] === '"' && source[index + 1] === '"') {
      index += 2;
      continue;
    }
    if (!verbatim && source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === quote) return index + 1;
    index += 1;
  }
  return source.length;
}

function replaceCSharpIdentifier(source, oldName, newName) {
  let output = "";
  let index = 0;
  let replacements = 0;

  while (index < source.length) {
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index + 2);
      const next = end === -1 ? source.length : end;
      output += source.slice(index, next);
      index = next;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      const next = end === -1 ? source.length : end + 2;
      output += source.slice(index, next);
      index = next;
      continue;
    }

    const stringPrefix = source.startsWith("$@\"", index) || source.startsWith("@$\"", index)
      ? { length: 2, verbatim: true }
      : source.startsWith("@\"", index)
        ? { length: 1, verbatim: true }
        : source.startsWith("$\"", index)
          ? { length: 1, verbatim: false }
          : source[index] === '"'
            ? { length: 0, verbatim: false }
            : null;

    if (stringPrefix) {
      const end = consumeQuoted(source, index, stringPrefix.length, '"', stringPrefix.verbatim);
      output += source.slice(index, end);
      index = end;
      continue;
    }

    if (source[index] === "'") {
      const end = consumeQuoted(source, index, 0, "'", false);
      output += source.slice(index, end);
      index = end;
      continue;
    }

    if (/[A-Za-z_]/.test(source[index])) {
      let end = index + 1;
      while (end < source.length && /[A-Za-z0-9_]/.test(source[end])) end += 1;
      const token = source.slice(index, end);
      if (token === oldName) {
        output += newName;
        replacements += 1;
      } else {
        output += token;
      }
      index = end;
      continue;
    }

    output += source[index];
    index += 1;
  }

  return { content: output, replacements };
}

async function buildRenamePlan(relativePath, newName) {
  if (!isValidCSharpIdentifier(newName)) {
    throw new Error("Новое имя должно быть корректным C#-идентификатором.");
  }

  const sourcePath = safeProjectPath(relativePath);
  if (path.extname(sourcePath).toLowerCase() !== ".cs") {
    throw new Error("Переименование поддерживается только для C#-файлов.");
  }

  const source = await fs.readFile(sourcePath, "utf8");
  const parsed = parseCSharp(relativePath, source);
  if (!parsed) throw new Error("В файле не найден класс.");
  const oldName = parsed.name;
  if (oldName === newName) throw new Error("Новое имя совпадает с текущим.");

  const files = await walk(projectRoot, new Set([".cs"]));
  const changes = [];
  for (const file of files) {
    const original = await fs.readFile(file, "utf8");
    const replaced = replaceCSharpIdentifier(original, oldName, newName);
    if (replaced.replacements > 0) {
      changes.push({
        absolutePath: file,
        path: toProjectPath(file),
        content: replaced.content,
        replacements: replaced.replacements,
      });
    }
  }

  const oldBaseName = path.basename(sourcePath, ".cs");
  const nextRelativePath = oldBaseName === oldName
    ? path.posix.join(path.posix.dirname(relativePath.replaceAll("\\", "/")), `${newName}.cs`)
    : relativePath.replaceAll("\\", "/");
  const nextAbsolutePath = safeProjectPath(nextRelativePath);

  if (nextAbsolutePath !== sourcePath) {
    try {
      await fs.access(nextAbsolutePath);
      throw new Error(`Файл ${nextRelativePath} уже существует.`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  return {
    oldName,
    newName,
    oldPath: relativePath.replaceAll("\\", "/"),
    newPath: nextRelativePath,
    changes,
    totalReplacements: changes.reduce((sum, item) => sum + item.replacements, 0),
  };
}

function publicRenamePlan(plan) {
  return {
    oldName: plan.oldName,
    newName: plan.newName,
    oldPath: plan.oldPath,
    newPath: plan.newPath,
    files: plan.changes.map(({ path: filePath, replacements }) => ({ path: filePath, replacements })),
    totalReplacements: plan.totalReplacements,
  };
}

async function applyRename(relativePath, newName) {
  const plan = await buildRenamePlan(relativePath, newName);
  for (const change of plan.changes) {
    await fs.writeFile(change.absolutePath, change.content, "utf8");
  }

  const oldAbsolutePath = safeProjectPath(plan.oldPath);
  const newAbsolutePath = safeProjectPath(plan.newPath);
  if (oldAbsolutePath !== newAbsolutePath) {
    await fs.rename(oldAbsolutePath, newAbsolutePath);
  }

  return { plan: publicRenamePlan(plan), graph: await analyzeProject(".") };
}

function createAnalyzerServer() {
  const server = new McpServer({ name: "game-builder", version: "0.4.0" });

  registerAppResource(server, widgetUri, widgetUri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{
      uri: widgetUri,
      mimeType: RESOURCE_MIME_TYPE,
      text: widgetHtml,
      _meta: {
        "openai/widgetPrefersBorder": false,
        "openai/widgetDescription": "Полноэкранный визуальный редактор архитектуры Unity-проекта.",
      },
    }],
  }));

  registerAppTool(server, "open_game_builder", {
    title: "Открыть Visual Game Builder",
    description: "Открывает визуальный конструктор объектов, компонентов, методов и зависимостей проекта.",
    inputSchema: {},
    _meta: { ui: { resourceUri: widgetUri }, "openai/outputTemplate": widgetUri },
  }, async () => ({
    content: [{ type: "text", text: "Visual Game Builder готов. Проект будет просканирован автоматически." }],
    structuredContent: { ready: true, projectRoot },
  }));

  registerAppTool(server, "analyze_project_architecture", {
    title: "Анализ архитектуры проекта",
    description: "Сканирует C#-файлы Unity-проекта и строит классы, методы, поля, зависимости и сетевые связи.",
    inputSchema: { directory: z.string().optional() },
    _meta: { ui: { resourceUri: widgetUri } },
  }, async ({ directory = "." }) => {
    const graph = await analyzeProject(directory);
    return {
      content: [{ type: "text", text: `Проанализировано файлов: ${graph.filesScanned}; объектов: ${graph.nodes.length}.` }],
      structuredContent: { graph },
    };
  });

  registerAppTool(server, "preview_rename_csharp_class", {
    title: "Проверить переименование C#-класса",
    description: "Показывает, какие C#-файлы и ссылки будут изменены при переименовании класса. Ничего не записывает.",
    inputSchema: { path: z.string().min(1), newName: z.string().min(1).max(128) },
    _meta: { ui: { resourceUri: widgetUri } },
  }, async ({ path: relativePath, newName }) => {
    const plan = publicRenamePlan(await buildRenamePlan(relativePath, newName));
    return {
      content: [{ type: "text", text: `Будет изменено файлов: ${plan.files.length}; замен: ${plan.totalReplacements}.` }],
      structuredContent: { plan },
    };
  });

  registerAppTool(server, "rename_csharp_class", {
    title: "Переименовать C#-класс",
    description: "Переименовывает класс и точные ссылки на него в C#-коде, а также файл, если его имя совпадает с классом.",
    inputSchema: { path: z.string().min(1), newName: z.string().min(1).max(128) },
    _meta: { ui: { resourceUri: widgetUri } },
  }, async ({ path: relativePath, newName }) => {
    const result = await applyRename(relativePath, newName);
    return {
      content: [{ type: "text", text: `Переименовано ${result.plan.oldName} → ${result.plan.newName}. Изменено файлов: ${result.plan.files.length}.` }],
      structuredContent: { ...result, renamed: true },
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
      path: toProjectPath(path.join(target, entry.name)),
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

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(payload));
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) return res.writeHead(400).end("Missing URL");
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS" && (url.pathname === mcpPath || url.pathname.startsWith("/api/"))) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    return res.end();
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(302, { location: "/app" });
    return res.end();
  }

  if (req.method === "GET" && url.pathname === "/app") {
    return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(widgetHtml);
  }

  if (req.method === "POST" && url.pathname === "/api/analyze") {
    try {
      const { directory = "." } = await readJsonBody(req);
      return sendJson(res, 200, { graph: await analyzeProject(directory) });
    } catch (error) {
      return sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/rename-preview") {
    try {
      const { path: relativePath, newName } = await readJsonBody(req);
      return sendJson(res, 200, { plan: publicRenamePlan(await buildRenamePlan(relativePath, newName)) });
    } catch (error) {
      return sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/rename") {
    try {
      const { path: relativePath, newName } = await readJsonBody(req);
      return sendJson(res, 200, { ...(await applyRename(relativePath, newName)), renamed: true });
    } catch (error) {
      return sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
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

httpServer.listen(port, () => {
  console.log(`Visual Game Builder MCP: http://localhost:${port}${mcpPath}`);
  console.log(`Visual Game Builder UI:  http://localhost:${port}/app`);
});
