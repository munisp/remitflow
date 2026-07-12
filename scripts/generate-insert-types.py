#!/usr/bin/env python3
"""
Generate missing $inferInsert type exports for all Drizzle ORM tables
that have $inferSelect but no corresponding Insert type.
"""
import re

with open('drizzle/schema.ts') as f:
    content = f.read()

# Find all table names
tables = re.findall(r'^export const (\w+) = pgTable', content, re.MULTILINE)

# Find all existing insert type names (e.g., export type InsertUser)
existing_insert = set(re.findall(r'export type Insert(\w+)', content))

# Find all existing select type names (e.g., export type User = typeof users.$inferSelect)
select_map = {}  # table_var -> type_name
for m in re.finditer(r'export type (\w+) = typeof (\w+)\.\$inferSelect', content):
    type_name, table_var = m.group(1), m.group(2)
    select_map[table_var] = type_name

# Generate missing insert types
missing_inserts = []
for table in tables:
    if table not in existing_insert and table in select_map:
        select_type = select_map[table]
        insert_type = f"Insert{select_type}"
        missing_inserts.append(f"export type {insert_type} = typeof {table}.$inferInsert;")

print(f"Total tables: {len(tables)}")
print(f"Tables with select types: {len(select_map)}")
print(f"Tables with existing insert types: {len(existing_insert)}")
print(f"Missing insert types to add: {len(missing_inserts)}")
print()

# Write to a new file
with open('drizzle/schema.types.ts', 'w') as f:
    f.write("/**\n")
    f.write(" * RemitFlow — Drizzle ORM Insert Type Exports\n")
    f.write(" * Auto-generated: provides $inferInsert types for all tables\n")
    f.write(" * that previously only had $inferSelect types.\n")
    f.write(" */\n")
    f.write("import type {\n")
    
    # Write all table imports
    for table in tables:
        if table in select_map and table not in existing_insert:
            f.write(f"  {table},\n")
    
    f.write('} from "./schema";\n\n')
    f.write("// ─── Insert Types for all tables ─────────────────────────────────────────────\n")
    
    for line in missing_inserts:
        f.write(line + "\n")

print(f"Written to drizzle/schema.types.ts")
