# Permify API Evidence for Containerized Authorization Validation

The validation stack uses the live Permify REST endpoints described in the official documentation:

- `POST /v1/tenants/{tenant_id}/schemas/write` accepts `{ "schema": "..." }` and returns a `schema_version`.
- `POST /v1/tenants/{tenant_id}/data/write` accepts a `metadata.schema_version` plus relationship `tuples`; each tuple contains `entity`, `relation`, and `subject` objects.
- `POST /v1/tenants/{tenant_id}/permissions/check` accepts `metadata` (`snap_token`, `schema_version`, `depth`), an `entity`, `permission`, and `subject`; valid results include `CHECK_RESULT_ALLOWED` and `CHECK_RESULT_DENIED`.

The RemitFlow live smoke check must write an isolated tenant schema and relationships, assert an authorized subject receives `CHECK_RESULT_ALLOWED`, and assert a subject from a separate tenant is returned as `CHECK_RESULT_DENIED`.

## References

1. [Permify: Interacting With the API](https://docs.permify.co/getting-started/enforcement)
2. [Permify: Schema Write API](https://docs.permify.co/api-reference/schema/write-schema)
3. [Permify: Data Write API](https://docs.permify.co/api-reference/data/write-data)
4. [Permify: Permission Check API](https://docs.permify.co/api-reference/permission/check-api)
