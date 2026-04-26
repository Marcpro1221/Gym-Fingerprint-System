"use strict";

const fs = require("node:fs");
const path = require("node:path");

let pool = null;
let PoolCtor = null;

const REPO_ROOT = path.resolve(__dirname, "../../..");
const ENV_DEFAULT_FILES = [
  path.join(REPO_ROOT, ".env.example"),
  path.join(REPO_ROOT, ".env")
];

const parseEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const fileContent = fs.readFileSync(filePath, "utf8");
  const entries = {};

  fileContent.split(/\r?\n/).forEach((line) => {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    if (!key) {
      return;
    }

    let value = trimmedLine.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries[key] = value;
  });

  return entries;
};

const loadLocalEnvDefaults = () => {
  const mergedEntries = ENV_DEFAULT_FILES.reduce(
    (accumulator, filePath) => ({
      ...accumulator,
      ...parseEnvFile(filePath)
    }),
    {}
  );

  Object.entries(mergedEntries).forEach(([key, value]) => {
    if (process.env[key] === undefined && value !== "") {
      process.env[key] = value;
    }
  });
};

loadLocalEnvDefaults();

const isDatabaseConfigured = () =>
  Boolean(
    process.env.DATABASE_URL ||
      (process.env.PGHOST && process.env.PGUSER && process.env.PGDATABASE)
  );

const loadPoolCtor = () => {
  if (PoolCtor) {
    return PoolCtor;
  }

  try {
    ({ Pool: PoolCtor } = require("pg"));
    return PoolCtor;
  } catch (error) {
    throw new Error(
      "PostgreSQL support requires the 'pg' package. Run npm install before using the member database routes."
    );
  }
};

const buildPoolConfig = () => {
  const sslMode = String(process.env.PGSSL || process.env.PGSSLMODE || "").toLowerCase();
  const ssl =
    sslMode === "true" || sslMode === "require"
      ? {
          rejectUnauthorized: false
        }
      : undefined;

  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl
    };
  }

  return {
    ssl
  };
};

const getPool = () => {
  if (!isDatabaseConfigured()) {
    throw new Error(
      "PostgreSQL is not configured. Set DATABASE_URL or PGHOST, PGUSER, and PGDATABASE before using member routes."
    );
  }

  if (!pool) {
    const Pool = loadPoolCtor();
    pool = new Pool(buildPoolConfig());
  }

  return pool;
};

const query = (text, params) => getPool().query(text, params);

const withTransaction = async (callback) => {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // Keep the original error. Rollback failure is secondary here.
    }
    throw error;
  } finally {
    client.release();
  }
};

const closePool = async () => {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
};

module.exports = {
  closePool,
  isDatabaseConfigured,
  query,
  withTransaction
};
