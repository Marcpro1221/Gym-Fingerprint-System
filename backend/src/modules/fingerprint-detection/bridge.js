"use strict";

const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  buildMatcherTemplateFromScanPayload,
  deleteMemberPermanently,
  listFingerprintMatchCandidates,
  listMembers,
  registerMemberFromScan,
  resolveFingerprintScanResult
} = require("../../models/member/service");
const {
  deleteMemberFromFileStore,
  listFingerprintMatchCandidatesFromFileStore,
  listMembersFromFileStore,
  registerMemberFromScanToFileStore,
  resolveFingerprintScanResultFromFileStore,
  STORE_PATH
} = require("../../models/member/file-store");
const {
  closePool,
  isDatabaseConfigured
} = require("../../db/postgres");

const PORT = Number(process.env.FINGERPRINT_BRIDGE_PORT || 4100);
const SCRIPT_PATH = path.join(__dirname, "digitalpersona-capture.ps1");
const MATCHER_SCRIPT_PATH = path.join(__dirname, "digitalpersona-match.ps1");
const MAX_JSON_BODY_BYTES = 1024 * 1024 * 2;

const buildCorsHeaders = (request, extraHeaders = {}) => {
  const origin = request?.headers?.origin;

  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Allow-Private-Network": "true",
    Vary: "Origin, Access-Control-Request-Private-Network",
    ...extraHeaders
  };
};

const json = (request, response, statusCode, payload) => {
  response.writeHead(
    statusCode,
    buildCorsHeaders(request, {
      "Content-Type": "application/json; charset=utf-8"
    })
  );
  response.end(JSON.stringify(payload));
};

const noContent = (request, response) => {
  response.writeHead(204, buildCorsHeaders(request));
  response.end();
};

const readBody = (request) =>
  new Promise((resolve, reject) => {
    let body = "";
    let bodyBytes = 0;

    request.on("data", (chunk) => {
      body += chunk;
      bodyBytes += chunk.length;
      if (bodyBytes > MAX_JSON_BODY_BYTES) {
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

const runPowerShellScript = async ({
  scriptPath,
  action,
  timeout,
  inputPayload
}) => {
  let inputPath = null;

  if (inputPayload !== undefined) {
    inputPath = path.join(os.tmpdir(), `gymflow-${randomUUID()}.json`);
    await fs.writeFile(inputPath, JSON.stringify(inputPayload), "utf8");
  }

  try {
    return await new Promise((resolve, reject) => {
      const args = [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath
      ];

      if (action) {
        args.push("-Action", action);
      }

      if (typeof timeout === "number" && Number.isFinite(timeout)) {
        args.push("-Timeout", String(timeout));
      }

      if (inputPath) {
        args.push("-InputPath", inputPath);
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
              stderr.trim() ||
                `PowerShell script exited without JSON output. Code: ${code}`
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
              `Unable to parse PowerShell response: ${output.slice(0, 240)}`
            )
          );
        }
      });
    });
  } finally {
    if (inputPath) {
      await fs.rm(inputPath, { force: true }).catch(() => {});
    }
  }
};

const runCaptureScript = (action, timeout) =>
  runPowerShellScript({
    scriptPath: SCRIPT_PATH,
    action,
    timeout
  });

const runMatcherScript = (inputPayload) =>
  runPowerShellScript({
    scriptPath: MATCHER_SCRIPT_PATH,
    inputPayload
  });

const toServiceStatusCode = (error) => {
  if (Number.isInteger(error?.statusCode) && error.statusCode >= 400) {
    return error.statusCode;
  }

  const message = String(error && error.message ? error.message : error);

  if (
    /PostgreSQL is not configured/i.test(message) ||
    /requires the 'pg' package/i.test(message)
  ) {
    return 503;
  }

  if (
    /required/i.test(message) ||
    /at least/i.test(message) ||
    /does not exist/i.test(message) ||
    /invalid/i.test(message) ||
    /missing/i.test(message)
  ) {
    return 400;
  }

  return 500;
};

const isDatabaseUnavailableError = (error) => {
  const message = String(error && error.message ? error.message : error);

  return (
    /PostgreSQL is not configured/i.test(message) ||
    /requires the 'pg' package/i.test(message) ||
    /password authentication failed/i.test(message) ||
    /ECONNREFUSED/i.test(message) ||
    /no pg_hba\.conf entry/i.test(message) ||
    /database ".+" does not exist/i.test(message) ||
    /role ".+" does not exist/i.test(message) ||
    /getaddrinfo/i.test(message)
  );
};

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    json(request, response, 400, {
      success: false,
      message: "Request URL is missing."
    });
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "OPTIONS") {
    noContent(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/fingerprint/status") {
    try {
      const payload = await runCaptureScript("status");
      json(request, response, payload.success ? 200 : 503, payload);
    } catch (error) {
      json(request, response, 500, {
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
        : 2000;

      const payload = await runCaptureScript("capture", timeout);
      json(request, response, payload.success ? 200 : 503, payload);
    } catch (error) {
      json(request, response, 500, {
        success: false,
        message: error.message,
        scriptPath: SCRIPT_PATH
      });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/fingerprint/identify") {
    try {
      const body = await readBody(request);
      const scanPayload =
        body.scanPayload && typeof body.scanPayload === "object"
          ? body.scanPayload
          : null;

      if (!scanPayload) {
        throw new Error("Fingerprint scan payload is required before matching.");
      }

      const probeTemplate = buildMatcherTemplateFromScanPayload(
        scanPayload,
        body.fingerLabel
      );

      if (!probeTemplate) {
        throw new Error(
          "The captured fingerprint metadata is incomplete. Capture the finger again before matching."
        );
      }

      let candidates;
      let matcherSource = "postgres";

      try {
        candidates = await listFingerprintMatchCandidates();
      } catch (error) {
        if (!isDatabaseUnavailableError(error)) {
          throw error;
        }

        candidates = await listFingerprintMatchCandidatesFromFileStore();
        matcherSource = "file-store";
      }

      let matcherResult = {
        success: true,
        matched: false,
        candidateCount: 0,
        comparedCandidates: 0
      };

      if (candidates.length > 0) {
        matcherResult = await runMatcherScript({
          probe: probeTemplate,
          candidates: candidates.map((candidate) => ({
            fingerprintId: candidate.fingerprintId,
            ...candidate.matcherTemplate
          }))
        });

        if (matcherResult.success === false) {
          throw new Error(matcherResult.message || "Fingerprint matcher failed.");
        }
      }

      const result =
        matcherSource === "postgres"
          ? await resolveFingerprintScanResult({
              scanPayload,
              matchedFingerprintId: matcherResult.matched
                ? matcherResult.matchedFingerprintId
                : null,
              score: matcherResult.bestScore,
              thresholdScore: matcherResult.thresholdScore
            })
          : await resolveFingerprintScanResultFromFileStore({
              matchedFingerprintId: matcherResult.matched
                ? matcherResult.matchedFingerprintId
                : null,
              score: matcherResult.bestScore,
              thresholdScore: matcherResult.thresholdScore
            });

      json(request, response, 200, {
        success: true,
        comparedCandidates:
          matcherResult.comparedCandidates ?? matcherResult.candidateCount ?? 0,
        source: matcherSource,
        ...result
      });
    } catch (error) {
      json(request, response, toServiceStatusCode(error), {
        success: false,
        message: error.message
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/fingerprint/health") {
    json(request, response, 200, {
      success: true,
      message: "Fingerprint bridge is running.",
      scriptPath: SCRIPT_PATH,
      matcherScriptPath: MATCHER_SCRIPT_PATH,
      databaseConfigured: isDatabaseConfigured(),
      fallbackStorePath: STORE_PATH
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    json(request, response, 200, {
      success: true,
      message: "GymFlow local API is running.",
      fingerprintScriptPath: SCRIPT_PATH,
      matcherScriptPath: MATCHER_SCRIPT_PATH,
      databaseConfigured: isDatabaseConfigured(),
      fallbackStorePath: STORE_PATH
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/members") {
    try {
      const requestedLimit = Number(url.searchParams.get("limit"));
      let members;
      let source = "postgres";

      try {
        members = await listMembers(requestedLimit);
      } catch (error) {
        if (!isDatabaseUnavailableError(error)) {
          throw error;
        }

        members = await listMembersFromFileStore(requestedLimit);
        source = "file-store";
      }

      json(request, response, 200, {
        success: true,
        count: members.length,
        members,
        source
      });
    } catch (error) {
      json(request, response, toServiceStatusCode(error), {
        success: false,
        message: error.message
      });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/members/register-from-scan") {
    try {
      const body = await readBody(request);
      const registrationInput = {
        fullName: body.fullName,
        mobileNumber: body.mobileNumber,
        planCode: body.planCode,
        fingerLabel: body.fingerLabel,
        scanPayload: body.scanPayload
      };
      let result;
      let source = "postgres";

      try {
        result = await registerMemberFromScan(registrationInput);
      } catch (error) {
        if (!isDatabaseUnavailableError(error)) {
          throw error;
        }

        result = await registerMemberFromScanToFileStore(registrationInput);
        source = "file-store";
      }

      json(request, response, 201, {
        success: true,
        message:
          source === "postgres"
            ? "Member registered successfully."
            : "Member registered successfully using the backend local store.",
        source,
        ...result
      });
    } catch (error) {
      json(request, response, toServiceStatusCode(error), {
        success: false,
        message: error.message
      });
    }
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/members/")) {
    try {
      const memberUuid = decodeURIComponent(
        url.pathname.slice("/api/members/".length)
      ).trim();

      if (!memberUuid) {
        throw new Error("Member id is required before deletion.");
      }

      let result;
      let source = "postgres";

      try {
        result = await deleteMemberPermanently(memberUuid);
      } catch (error) {
        if (!isDatabaseUnavailableError(error)) {
          throw error;
        }

        result = await deleteMemberFromFileStore(memberUuid);
        source = "file-store";
      }

      json(request, response, 200, {
        success: true,
        message:
          source === "postgres"
            ? "Member deleted permanently."
            : "Member deleted permanently from the backend local store.",
        source,
        ...result
      });
    } catch (error) {
      json(request, response, toServiceStatusCode(error), {
        success: false,
        message: error.message
      });
    }
    return;
  }

  json(request, response, 404, {
    success: false,
    message: "Route not found."
  });
});

server.listen(PORT, () => {
  console.log(`Fingerprint bridge listening on http://localhost:${PORT}`);
  console.log(`DigitalPersona capture script: ${SCRIPT_PATH}`);
  console.log(`DigitalPersona matcher script: ${MATCHER_SCRIPT_PATH}`);
});

const shutdown = async () => {
  server.close(() => {
    // No-op. This callback only ensures close is requested.
  });

  try {
    await closePool();
  } catch (error) {
    console.error("Failed to close PostgreSQL pool cleanly:", error.message);
  }
};

process.on("SIGINT", () => {
  shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  shutdown().finally(() => process.exit(0));
});
