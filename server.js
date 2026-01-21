#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "fs";
import path from "path";

const server = new Server({
  name: "regex-search-server",
  version: "1.0.0",
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "regex_search",
        description:
          "Search for a regex pattern in files and return line numbers of matches",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "The regex pattern to search for",
            },
            filePath: {
              type: "string",
              description: "Path to the file to search in",
            },
            flags: {
              type: "string",
              description: "Regex flags (g, i, m, s) - default: 'g'",
              default: "g",
            },
          },
          required: ["pattern", "filePath"],
        },
      },
      {
        name: "regex_search_directory",
        description:
          "Recursively search for a regex pattern in all files in a directory",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "The regex pattern to search for",
            },
            dirPath: {
              type: "string",
              description: "Path to the directory to search in",
            },
            fileExtensions: {
              type: "array",
              items: { type: "string" },
              description: "File extensions to search (e.g., ['.js', '.ts', '.txt'])",
              default: [".js", ".ts", ".txt", ".md", ".json"],
            },
            flags: {
              type: "string",
              description: "Regex flags (g, i, m, s) - default: 'g'",
              default: "g",
            },
          },
          required: ["pattern", "dirPath"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request;

  if (name === "regex_search") {
    return handleRegexSearch(args);
  } else if (name === "regex_search_directory") {
    return handleRegexSearchDirectory(args);
  }

  return {
    content: [
      {
        type: "text",
        text: `Unknown tool: ${name}`,
      },
    ],
    isError: true,
  };
});

function handleRegexSearch(args) {
  try {
    const { pattern, filePath, flags = "g" } = args;

    const resolvedPath = path.resolve(filePath);

    if (!fs.existsSync(resolvedPath)) {
      return {
        content: [
          {
            type: "text",
            text: `File not found: ${resolvedPath}`,
          },
        ],
        isError: true,
      };
    }

    const fileContent = fs.readFileSync(resolvedPath, "utf-8");
    const lines = fileContent.split("\n");

    const regex = new RegExp(pattern, flags);
    const matches = [];

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const lineMatches = [];

      let match;
      const lineRegex = new RegExp(pattern, flags);

      while ((match = lineRegex.exec(line)) !== null) {
        lineMatches.push({
          matchText: match[0],
          column: match.index + 1,
        });
      }

      if (lineMatches.length > 0) {
        matches.push({
          lineNumber,
          content: line,
          matches: lineMatches,
        });
      }
    });

    const result = {
      file: resolvedPath,
      pattern,
      flags,
      totalMatches: matches.reduce((sum, m) => sum + m.matches.length, 0),
      results: matches,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

function handleRegexSearchDirectory(args) {
  try {
    const {
      pattern,
      dirPath,
      fileExtensions = [".js", ".ts", ".txt", ".md", ".json"],
      flags = "g",
    } = args;

    // Resolve the directory path
    const resolvedDir = path.resolve(dirPath);

    // Check if directory exists
    if (!fs.existsSync(resolvedDir)) {
      return {
        content: [
          {
            type: "text",
            text: `Directory not found: ${resolvedDir}`,
          },
        ],
        isError: true,
      };
    }

    const results = [];
    let totalMatches = 0;

    function searchDirectory(dir) {
      const files = fs.readdirSync(dir);

      files.forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
          // Skip common directories
          if (!file.startsWith(".") && file !== "node_modules") {
            searchDirectory(filePath);
          }
        } else if (stat.isFile()) {
          const ext = path.extname(file);
          if (fileExtensions.includes(ext)) {
            try {
              const fileContent = fs.readFileSync(filePath, "utf-8");
              const lines = fileContent.split("\n");
              const fileMatches = [];

              lines.forEach((line, index) => {
                const lineNumber = index + 1;
                const lineRegex = new RegExp(pattern, flags);
                let match;
                const lineMatches = [];

                while ((match = lineRegex.exec(line)) !== null) {
                  lineMatches.push({
                    matchText: match[0],
                    column: match.index + 1,
                  });
                }

                if (lineMatches.length > 0) {
                  fileMatches.push({
                    lineNumber,
                    content: line,
                    matches: lineMatches,
                  });
                  totalMatches += lineMatches.length;
                }
              });

              if (fileMatches.length > 0) {
                results.push({
                  file: filePath,
                  matchCount: fileMatches.reduce(
                    (sum, m) => sum + m.matches.length,
                    0
                  ),
                  results: fileMatches,
                });
              }
            } catch (error) {
              // Skip files that can't be read
            }
          }
        }
      });
    }

    searchDirectory(resolvedDir);

    const result = {
      directory: resolvedDir,
      pattern,
      flags,
      extensions: fileExtensions,
      filesMatched: results.length,
      totalMatches,
      results,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Regex Search MCP Server running on stdio");
}

main().catch(console.error);
