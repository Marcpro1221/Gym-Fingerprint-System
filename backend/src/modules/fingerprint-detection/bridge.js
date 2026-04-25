"use strict";

const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PORT = Number(process.env.FINGERPRINT_BRIDGE_PORT || 4100);
const SCRIPT_PATH = path.join(__dirname, "digitalpersona-capture.ps1");

const json = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(JSON.stringify(payload));
};

const noContent = (response) => {
  response.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end();
};

const readBody = (request) =>
  new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 32) {
        reject(new Error("Request body is too large."));
      }
    });

    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    request.on("error", reject);
  });

const runCaptureScript = (action, timeout) =>
  new Promise((resolve, reject) => {
    const args = [
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      SCRIPT_PATH,
      "-Action",
      action
    ];

    if (typeof timeout === "number" && Number.isFinite(timeout)) {
      args.push("-Timeout", String(timeout));
    }

    const child = spawn("powershell.exe", args, {
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      const output = stdout.trim();

      if (!output) {
        reject(
          new Error(
            stderr.trim() || `DigitalPersona script exited without JSON output. Code: ${code}`
          )
        );
        return;
      }

      try {
        const payload = JSON.parse(output);
        resolve(payload);
      } catch (error) {
        reject(
          new Error(
            `Unable to parse DigitalPersona response: ${output.slice(0, 240)}`
          )
        );
      }
    });
  });

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    json(response, 400, {
      success: false,
      message: "Request URL is missing."
    });
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "OPTIONS") {
    noContent(response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/fingerprint/status") {
    try {
      const payload = await runCaptureScript("status");
      json(response, payload.success ? 200 : 503, payload);
    } catch (error) {
      json(response, 500, {
        success: false,
        message: error.message,
        scriptPath: SCRIPT_PATH
      });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/fingerprint/capture") {
    try {
      const body = await readBody(request);
      const requestedTimeout = Number(body.timeout);
      const timeout = Number.isFinite(requestedTimeout)
        ? Math.max(1000, Math.min(30000, requestedTimeout))
        : 5000;

      const payload = await runCaptureScript("capture", timeout);
      json(response, payload.success ? 200 : 503, payload);
    } catch (error) {
      json(response, 500, {
        success: false,
        message: error.message,
        scriptPath: SCRIPT_PATH
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/fingerprint/health") {
    json(response, 200, {
      success: true,
      message: "Fingerprint bridge is running.",
      scriptPath: SCRIPT_PATH
    });
    return;
  }

  json(response, 404, {
    success: false,
    message: "Route not found."
  });
});

server.listen(PORT, () => {
  console.log(`Fingerprint bridge listening on http://localhost:${PORT}`);
  console.log(`DigitalPersona script: ${SCRIPT_PATH}`);
});
