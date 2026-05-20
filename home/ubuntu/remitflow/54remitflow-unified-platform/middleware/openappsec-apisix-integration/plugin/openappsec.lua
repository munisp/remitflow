--
-- Licensed to the Apache Software Foundation (ASF) under one or more
-- contributor license agreements.  See the NOTICE file distributed with
-- this work for additional information regarding copyright ownership.
-- The ASF licenses this file to You under the Apache License, Version 2.0
-- (the "License"); you may not use this file except in compliance with
-- the License.  You may obtain a copy of the License at
--
--     http://www.apache.org/licenses/LICENSE-2.0
--
-- Unless required by applicable law or agreed to in writing, software
-- distributed under the License is distributed on an "AS IS" BASIS,
-- WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
-- See the License for the specific language governing permissions and
-- limitations under the License.
--

local core = require("apisix.core")
local http = require("resty.http")
local ngx = ngx
local ipairs = ipairs
local type = type

local schema = {
    type = "object",
    properties = {
        openappsec_host = {
            type = "string",
            description = "openappsec agent host",
            default = "openappsec-agent"
        },
        openappsec_port = {
            type = "integer",
            description = "openappsec agent port",
            default = 8080,
            minimum = 1,
            maximum = 65535
        },
        timeout = {
            type = "integer",
            description = "Request timeout in milliseconds",
            default = 5000,
            minimum = 100,
            maximum = 60000
        },
        policy_name = {
            type = "string",
            description = "Security policy name",
            default = "default-policy"
        },
        block_mode = {
            type = "string",
            description = "Action when threat detected: block or monitor",
            enum = {"block", "monitor"},
            default = "block"
        },
        log_level = {
            type = "string",
            description = "Logging level",
            enum = {"debug", "info", "warn", "error"},
            default = "info"
        },
        enable_body_inspection = {
            type = "boolean",
            description = "Enable request/response body inspection",
            default = true
        },
        max_body_size = {
            type = "integer",
            description = "Maximum body size to inspect (bytes)",
            default = 1048576,  -- 1MB
            minimum = 0
        },
        custom_headers = {
            type = "object",
            description = "Custom headers to add to openappsec request",
            additionalProperties = {
                type = "string"
            }
        }
    },
    required = {"openappsec_host"}
}

local _M = {
    version = 1.0,
    priority = 2500,  -- Execute before most plugins but after authentication
    name = "openappsec",
    schema = schema,
}

-- Create HTTP client for openappsec communication
local function create_http_client(conf)
    local httpc = http.new()
    httpc:set_timeout(conf.timeout)
    return httpc
end

-- Build request object for openappsec
local function build_inspection_request(conf, ctx)
    local request_data = {
        method = ngx.req.get_method(),
        uri = ngx.var.request_uri,
        headers = ngx.req.get_headers(),
        remote_addr = ngx.var.remote_addr,
        server_name = ngx.var.server_name,
        policy_name = conf.policy_name,
        timestamp = ngx.time()
    }
    
    -- Add request body if enabled
    if conf.enable_body_inspection then
        ngx.req.read_body()
        local body = ngx.req.get_body_data()
        if body and #body <= conf.max_body_size then
            request_data.body = body
        end
    end
    
    -- Add custom headers
    if conf.custom_headers then
        for key, value in pairs(conf.custom_headers) do
            request_data.headers[key] = value
        end
    end
    
    return request_data
end

-- Send request to openappsec for inspection
local function inspect_request(conf, ctx, httpc)
    local openappsec_url = "http://" .. conf.openappsec_host .. ":" .. conf.openappsec_port .. "/api/v1/inspect"
    
    local request_data = build_inspection_request(conf, ctx)
    local request_json = core.json.encode(request_data)
    
    local res, err = httpc:request_uri(openappsec_url, {
        method = "POST",
        body = request_json,
        headers = {
            ["Content-Type"] = "application/json",
            ["X-APISIX-Plugin"] = "openappsec",
            ["X-Request-ID"] = ctx.var.request_id or ngx.var.request_id
        }
    })
    
    if not res then
        core.log.error("Failed to connect to openappsec: ", err)
        return nil, err
    end
    
    if res.status ~= 200 then
        core.log.error("openappsec returned error status: ", res.status)
        return nil, "openappsec error: " .. res.status
    end
    
    local verdict, decode_err = core.json.decode(res.body)
    if not verdict then
        core.log.error("Failed to decode openappsec response: ", decode_err)
        return nil, decode_err
    end
    
    return verdict, nil
end

-- Handle threat detection
local function handle_threat(conf, verdict)
    local threat_info = {
        threat_id = verdict.threat_id or "unknown",
        threat_type = verdict.threat_type or "unknown",
        severity = verdict.severity or "medium",
        description = verdict.description or "Threat detected",
        timestamp = ngx.time()
    }
    
    -- Log threat
    if conf.log_level == "debug" or conf.log_level == "info" then
        core.log.warn("Threat detected: ", core.json.encode(threat_info))
    end
    
    -- Block or monitor
    if conf.block_mode == "block" then
        return 403, {
            error = "Request blocked by security policy",
            threat_id = threat_info.threat_id,
            threat_type = threat_info.threat_type,
            message = "Your request has been blocked due to security policy violation"
        }
    else
        -- Monitor mode: log but allow request
        core.log.warn("Threat detected (monitor mode): ", core.json.encode(threat_info))
        return nil, nil
    end
end

function _M.check_schema(conf)
    return core.schema.check(schema, conf)
end

function _M.access(conf, ctx)
    -- Create HTTP client
    local httpc, err = create_http_client(conf)
    if not httpc then
        core.log.error("Failed to create HTTP client: ", err)
        if conf.block_mode == "block" then
            return 503, {error = "Security service unavailable"}
        end
        return  -- Allow request in monitor mode
    end
    
    -- Inspect request
    local verdict, inspect_err = inspect_request(conf, ctx, httpc)
    if not verdict then
        core.log.error("Failed to inspect request: ", inspect_err)
        if conf.block_mode == "block" then
            return 503, {error = "Security inspection failed"}
        end
        return  -- Allow request in monitor mode
    end
    
    -- Check verdict
    if verdict.action == "block" or verdict.threat_detected then
        local status, body = handle_threat(conf, verdict)
        if status then
            return status, body
        end
    end
    
    -- Add security headers to request
    if verdict.security_headers then
        for key, value in pairs(verdict.security_headers) do
            core.request.set_header(ctx, key, value)
        end
    end
    
    -- Store verdict in context for logging
    ctx.openappsec_verdict = verdict
    
    -- Log successful inspection
    if conf.log_level == "debug" then
        core.log.info("Request passed security inspection: ", core.json.encode(verdict))
    end
end

function _M.log(conf, ctx)
    -- Log security metrics
    local verdict = ctx.openappsec_verdict
    if verdict then
        local log_data = {
            request_id = ctx.var.request_id or ngx.var.request_id,
            verdict = verdict.action or "allow",
            threat_detected = verdict.threat_detected or false,
            threat_type = verdict.threat_type,
            latency_ms = verdict.latency_ms,
            timestamp = ngx.time()
        }
        
        if conf.log_level == "debug" or conf.log_level == "info" then
            core.log.info("openappsec log: ", core.json.encode(log_data))
        end
    end
end

return _M

