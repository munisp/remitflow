import postgres from "postgres";
const url = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL || "";
console.log("Connecting to:", url.replace(/:[^:@]+@/, ":***@").split("?")[0]);
const p = postgres(url, { max: 1, connect_timeout: 5 });
p`SELECT 1 AS ok`.then(r => { console.log("postgres OK:", r); process.exit(0); })
  .catch(e => { console.error("postgres ERR:", e.message); process.exit(1); });
