--- 54remit APISIX Access Plugin

local core = require("apisix.core")
local http = require("resty.http")
local jwt = require("resty.jwt")
local ngx = ngx

local plugin_name = "54remit-access-plugin"

local schema = {
    type = "object",
    properties = {
        authorizer_url = {
            type = "string",
            minLength = 1,
            description = "The url used to validate jwt",
        },
        mint_account_url = {
            type = "string",
            minLength = 1,
            description = "The url used to retreive mint account information",
        },
        keycloak_public_key_url = {
            type = "string",
            minLength = 1,
            description = "The url used to retreive tenant keycloak public key",
        },
        tenant_claim = {
            type = "string",
            default = "tenant_id",
            description = "Verified JWT claim that must match x-tenant-id when require_tenant_claim is enabled",
        },
        require_tenant_claim = {
            type = "boolean",
            default = false,
            description = "Require a signed token tenant claim in addition to authorizer realm validation",
        },
    },
    required = {"authorizer_url", "mint_account_url", "keycloak_public_key_url"},
}

local _M = {
    version = 0.1,
    priority = 2509,
    name = plugin_name,
    schema = schema,
}

local function fetch_data_from_authorizer(authorizer_url, token, tenant_id, keycloak_realm, keycloak_public_key)
    local httpc = http.new()
    local res, err = httpc:request_uri(authorizer_url .. "/" .. "validate/" .. token, {
        method = "GET",
        headers = {
            ["x-tenant-id"] = tenant_id, -- Add the x-tenant-id header
            ["x-keycloak-realm"] = keycloak_realm, -- Add the x-keycloak-realm header
            ["x-keycloak-pub-key"] = keycloak_public_key, -- Add the x-tenant-id header
        },
    })

    if not res then
        return nil, nil, "failed to verify token: " .. err
    end

    if res.status ~= 200 then
        return nil, nil, "failed to verify token, status: " .. res.status
    end

    local result = core.json.decode(res.body)
    if not result or not result.keycloak_id then
        return nil, nil, "failed to verify token"
    end

    return result.keycloak_id
end

local function fetch_mint_account_data(mint_account_url, tenant_id, ledger_id, keycloak_id)
    local httpc = http.new()
    local res, err = httpc:request_uri(mint_account_url, {
        method = "GET",
        headers = {
            ["x-tenant-id"] = tenant_id, -- Add the x-tenant-id header
            ["x-ledger-id"] = ledger_id, -- Add the x-ledger-id header
            ["x-keycloak-id"] = keycloak_id, -- Add the x-keycloak-id header
        },
    })

    if not res then
        return nil, nil, "failed to get mint account: " .. err
    end

    if res.status ~= 200 then
        return nil, nil, "failed to get mint account, status: " .. res.status
    end

    local result = core.json.decode(res.body)
    if not result or not result.id then
        return nil, nil, "failed to get mint account"
    end

    return result.id
end

local function fetch_tenant_keycloak_public_key(keycloak_public_key_url, tenant_id)
    local httpc = http.new()
    local res, err = httpc:request_uri(keycloak_public_key_url .. "/" .. tenant_id, {
        method = "GET",
        headers = {
            ["x-tenant-id"] = tenant_id, -- Add the x-tenant-id header
        },
    })

    if not res then
        return nil, nil, "failed to get tenant public key: " .. err
    end

    if res.status ~= 200 then
        return nil, nil, "failed to get tenant public key, status: " .. res.status
    end

    local result = core.json.decode(res.body)
    if not result or not result.public_rsa_key then
        return nil, nil, "failed to get tenant public key"
    end
    
    return result.public_rsa_key
end

-- Helper function to extract a cookie by name
local function get_cookie(ctx, cookie_name)
    local cookie_header = ctx.var.http_cookie
    if not cookie_header then
        return nil
    end

    for cookie in string.gmatch(cookie_header, "[^;]+") do
        local key, value = string.match(cookie, "%s*(.-)%s*=%s*(.*)")
        if key == cookie_name then
            return value
        end
    end

    return nil
end

-- Extract a credential without writing secrets to APISIX logs. Query-string tokens
-- are intentionally unsupported because they leak through proxy logs and referrers.
local function get_token(ctx)
    local token = get_cookie(ctx, "access_token")
    if token then
        return token
    end
    local auth_header = core.request.header(ctx, "Authorization")
    if auth_header then
        return auth_header:match("^Bearer%s+([A-Za-z0-9_-]+%.[A-Za-z0-9_-]+%.[A-Za-z0-9_-]+)$")
    end
    return nil
end

local function validate_jwt_shape(token, conf, tenant_id)
    if not token or #token > 16384 then
        return nil, "Malformed JWT token"
    end
    local header, claims, signature = token:match("^([A-Za-z0-9_-]+)%.([A-Za-z0-9_-]+)%.([A-Za-z0-9_-]+)$")
    if not header or not claims or not signature or #header > 2048 or #claims > 8192 or #signature > 8192 then
        return nil, "JWT must have exactly three bounded base64url segments"
    end
    local parsed = jwt:load_jwt(token)
    if not parsed or not parsed.valid or not parsed.header or not parsed.payload then
        return nil, "JWT header or payload is invalid"
    end
    if parsed.header.alg == "none" or not parsed.header.alg then
        return nil, "Unsigned JWTs are not permitted"
    end
    if conf.require_tenant_claim then
        local claimed_tenant = parsed.payload[conf.tenant_claim]
        if type(claimed_tenant) ~= "string" or claimed_tenant ~= tenant_id then
            return nil, "JWT tenant claim does not match the requested tenant"
        end
    end
    return parsed
end

function _M.access(conf, ctx)
    -- Preflight carries no credential and must not be evaluated as a tenant request.
    if ctx.var.request_method == "OPTIONS" then
        return
    end

    local tenant_id = core.request.header(ctx, "x-tenant-id")
    if type(tenant_id) ~= "string" or not tenant_id:match("^[A-Za-z0-9_-]+$") or #tenant_id > 128 then
        return 400, {message = "Missing or invalid tenant identifier"}
    end
    local keycloak_realm = "54remit_" .. tenant_id
    local ledger_id = "1"

    local token = get_token(ctx)
    if not token then
        return 401, {message = "Missing or malformed bearer JWT"}
    end
    local _, jwt_err = validate_jwt_shape(token, conf, tenant_id)
    if jwt_err then
        return 401, {message = jwt_err}
    end

    local keycloak_public_key, err = fetch_tenant_keycloak_public_key(conf.keycloak_public_key_url, tenant_id)
    if not keycloak_public_key then
        return 401, {message = err}
    end

    local keycloak_id, err = fetch_data_from_authorizer(conf.authorizer_url, token, tenant_id, keycloak_realm, keycloak_public_key)
    if not keycloak_id then
        return 401, {message = err}
    end

    local mint_account_id, err = fetch_mint_account_data(conf.mint_account_url, tenant_id, ledger_id, keycloak_id)
    if not mint_account_id then
        return 401, {message = err}
    end

    core.request.set_header(ctx, "x-tenant-id", tenant_id)
    core.request.set_header(ctx, "x-keycloak-id", keycloak_id)
    core.request.set_header(ctx, "x-keycloak-realm", "54remit_" .. tenant_id)
    core.request.set_header(ctx, "x-keycloak-pub-key", keycloak_public_key)
    core.request.set_header(ctx, "x-ledger-id", ledger_id)
    core.request.set_header(ctx, "x-mint-account-id", mint_account_id)
end

function _M.check_schema(conf, schema_type)
    return core.schema.check(schema, conf)
end

return _M
