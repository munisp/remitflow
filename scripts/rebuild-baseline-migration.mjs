import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const snapshotPath = path.join(root, "drizzle", "meta", "0051_snapshot.json");
const firstAvailableMigrationPath = path.join(root, "drizzle", "0051_military_silver_sable.sql");
const outputPath = path.join(root, "drizzle", "0000_baseline_schema.sql");

const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
const qualified = (schema, name) => schema && schema !== "public" ? `${quote(schema)}.${quote(name)}` : quote(name);
function createdObjects(sql, kind) {
  const expression = new RegExp(`CREATE ${kind.toUpperCase()}\\s+(?:"public"\\.)?"([^"]+)"`, "gi");
  return new Set(Array.from(sql.matchAll(expression), (match) => match[1]));
}

function renderDefault(value) {
  if (value === undefined || value === null) return "";
  return ` DEFAULT ${value}`;
}

function renderColumn(column) {
  const type = column.typeSchema ? qualified(column.typeSchema, column.type) : column.type;
  const parts = [quote(column.name), type];
  if (column.generated?.type === "always") {
    parts.push(` GENERATED ALWAYS AS (${column.generated.as}) STORED`);
  }
  if (column.default !== undefined && column.default !== null) parts.push(renderDefault(column.default));
  if (column.notNull) parts.push(" NOT NULL");
  if (column.primaryKey) parts.push(" PRIMARY KEY");
  return parts.join(" ");
}

function renderIndex(table, index) {
  const method = index.method && index.method !== "btree" ? ` USING ${index.method}` : "";
  const unique = index.unique ? "UNIQUE " : "";
  const concurrently = index.concurrently ? " CONCURRENTLY" : "";
  const columns = (index.columns ?? []).map((column) => {
    if (typeof column === "string") return quote(column);
    const expression = column.isExpression ? column.expression : quote(column.expression ?? column.name);
    return `${expression}${column.opclass ? ` ${column.opclass}` : ""}${column.asc === false ? " DESC" : ""}${column.nulls === "last" ? " NULLS LAST" : ""}`;
  }).join(", ");
  const where = index.where ? ` WHERE ${index.where}` : "";
  const withClause = index.with && Object.keys(index.with).length > 0
    ? ` WITH (${Object.entries(index.with).map(([key, value]) => `${key}=${value}`).join(", ")})`
    : "";
  return `CREATE ${unique}INDEX${concurrently} ${quote(index.name)} ON ${qualified(table.schema, table.name)}${method} (${columns})${withClause}${where};`;
}

function renderForeignKey(table, foreignKey) {
  const local = foreignKey.columnsFrom.map(quote).join(", ");
  const target = foreignKey.columnsTo.map(quote).join(", ");
  const onDelete = foreignKey.onDelete ? ` ON DELETE ${foreignKey.onDelete}` : "";
  const onUpdate = foreignKey.onUpdate ? ` ON UPDATE ${foreignKey.onUpdate}` : "";
  return `ALTER TABLE ${qualified(table.schema, table.name)} ADD CONSTRAINT ${quote(foreignKey.name)} FOREIGN KEY (${local}) REFERENCES ${qualified("public", foreignKey.tableTo)} (${target})${onDelete}${onUpdate};`;
}

const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
const firstMigration = await readFile(firstAvailableMigrationPath, "utf8");
const tablesCreatedBy0051 = createdObjects(firstMigration, "table");
const enumsCreatedBy0051 = createdObjects(firstMigration, "type");
const baselineTables = Object.values(snapshot.tables).filter((table) => !tablesCreatedBy0051.has(table.name));
const baselineEnums = Object.values(snapshot.enums).filter((enumeration) => !enumsCreatedBy0051.has(enumeration.name));

const lines = [
  "-- Reconstructed canonical baseline for missing legacy migrations 0000–0050.",
  "-- Source: drizzle/meta/0051_snapshot.json. This creates the state expected before 0051.",
  "-- Regenerate with: node scripts/rebuild-baseline-migration.mjs",
  "",
];

for (const enumeration of baselineEnums.sort((left, right) => left.name.localeCompare(right.name))) {
  const values = enumeration.values.map((value) => `'${String(value).replaceAll("'", "''")}'`).join(", ");
  lines.push(`CREATE TYPE ${qualified(enumeration.schema, enumeration.name)} AS ENUM (${values});`, "");
}

for (const table of baselineTables.sort((left, right) => left.name.localeCompare(right.name))) {
  const definitions = Object.values(table.columns).map(renderColumn);
  for (const constraint of Object.values(table.uniqueConstraints ?? {})) {
    definitions.push(`CONSTRAINT ${quote(constraint.name)} UNIQUE (${constraint.columns.map(quote).join(", ")})`);
  }
  for (const constraint of Object.values(table.checkConstraints ?? {})) {
    definitions.push(`CONSTRAINT ${quote(constraint.name)} CHECK (${constraint.value})`);
  }
  for (const primaryKey of Object.values(table.compositePrimaryKeys ?? {})) {
    definitions.push(`CONSTRAINT ${quote(primaryKey.name)} PRIMARY KEY (${primaryKey.columns.map(quote).join(", ")})`);
  }
  lines.push(`CREATE TABLE ${qualified(table.schema, table.name)} (\n  ${definitions.join(",\n  ")}\n);`, "");
}

for (const table of baselineTables.sort((left, right) => left.name.localeCompare(right.name))) {
  for (const foreignKey of Object.values(table.foreignKeys ?? {})) lines.push(renderForeignKey(table, foreignKey));
}
lines.push("");
for (const table of baselineTables.sort((left, right) => left.name.localeCompare(right.name))) {
  for (const index of Object.values(table.indexes ?? {})) lines.push(renderIndex(table, index));
}
lines.push("");

await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${outputPath} with ${baselineEnums.length} enums and ${baselineTables.length} tables.`);
console.log(`Excluded ${enumsCreatedBy0051.size} enums and ${tablesCreatedBy0051.size} tables introduced by 0051.`);
