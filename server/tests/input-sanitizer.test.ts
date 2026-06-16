/**
 * Input Sanitizer Business Logic Tests
 * Tests: XSS detection, HTML escaping, SSRF prevention, webhook validation
 */
import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  containsXss,
  sanitizeString,
  isPrivateUrl,
  validateWebhookUrl,
} from "../lib/inputSanitizer";

describe("Input Sanitizer — escapeHtml", () => {
  it("should escape < and > to HTML entities", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;&#x2F;script&gt;"
    );
  });

  it("should escape & to &amp;", () => {
    expect(escapeHtml("foo & bar")).toBe("foo &amp; bar");
  });

  it("should escape double and single quotes", () => {
    expect(escapeHtml('"hello\' world"')).toBe("&quot;hello&#x27; world&quot;");
  });

  it("should escape backticks", () => {
    expect(escapeHtml("`eval`")).toBe("&#96;eval&#96;");
  });

  it("should pass through safe text unchanged", () => {
    expect(escapeHtml("Hello World 123")).toBe("Hello World 123");
  });
});

describe("Input Sanitizer — containsXss", () => {
  it("should detect <script> tags", () => {
    expect(containsXss("<script>alert(1)</script>")).toBe(true);
    expect(containsXss("<SCRIPT>alert(1)</SCRIPT>")).toBe(true);
  });

  it("should detect javascript: protocol", () => {
    expect(containsXss("javascript:void(0)")).toBe(true);
  });

  it("should detect event handler attributes", () => {
    expect(containsXss('onload="steal()"')).toBe(true);
    expect(containsXss("onerror =alert(1)")).toBe(true);
  });

  it("should detect data:text/html payloads", () => {
    expect(containsXss("data: text/html,<h1>hi</h1>")).toBe(true);
  });

  it("should detect vbscript: protocol", () => {
    expect(containsXss("vbscript:msgbox")).toBe(true);
  });

  it("should NOT flag normal text", () => {
    expect(containsXss("Hello, this is a normal message")).toBe(false);
    expect(containsXss("Amount: $500 for order #1234")).toBe(false);
  });
});

describe("Input Sanitizer — sanitizeString", () => {
  it("should trim whitespace", () => {
    expect(sanitizeString("  hello  ")).toBe("hello");
  });

  it("should strip control characters", () => {
    expect(sanitizeString("hello\x00world\x7F")).toBe("helloworld");
  });

  it("should escape HTML when XSS detected", () => {
    const result = sanitizeString("<script>alert(1)</script>");
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("should leave non-XSS text unchanged (after trim)", () => {
    expect(sanitizeString("Normal transaction note")).toBe("Normal transaction note");
  });
});

describe("Input Sanitizer — isPrivateUrl (SSRF protection)", () => {
  it("should detect 10.x.x.x as private", () => {
    expect(isPrivateUrl("http://10.0.0.1/api")).toBe(true);
  });

  it("should detect 192.168.x.x as private", () => {
    expect(isPrivateUrl("http://192.168.1.1/webhook")).toBe(true);
  });

  it("should detect 172.16-31.x.x as private", () => {
    expect(isPrivateUrl("http://172.16.0.1")).toBe(true);
    expect(isPrivateUrl("http://172.31.255.255")).toBe(true);
  });

  it("should detect 127.x.x.x (loopback) as private", () => {
    expect(isPrivateUrl("http://127.0.0.1:3000")).toBe(true);
  });

  it("should detect localhost as private", () => {
    expect(isPrivateUrl("http://localhost:8080")).toBe(true);
  });

  it("should detect link-local (169.254) as private", () => {
    expect(isPrivateUrl("http://169.254.169.254/latest")).toBe(true);
  });

  it("should accept public URLs", () => {
    expect(isPrivateUrl("https://api.stripe.com/v1/charges")).toBe(false);
    expect(isPrivateUrl("https://hooks.slack.com/services/T00/B00/xxxx")).toBe(false);
  });

  it("should reject invalid URLs as private (fail-closed)", () => {
    expect(isPrivateUrl("not-a-url")).toBe(true);
  });
});

describe("Input Sanitizer — validateWebhookUrl", () => {
  it("should accept valid HTTPS public URLs", () => {
    expect(validateWebhookUrl("https://hooks.example.com/callback")).toEqual({
      valid: true,
    });
  });

  it("should reject HTTP (non-HTTPS) URLs", () => {
    const result = validateWebhookUrl("http://hooks.example.com/callback");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("HTTPS");
  });

  it("should reject private/internal URLs", () => {
    const result = validateWebhookUrl("https://192.168.1.1/webhook");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Private");
  });

  it("should reject invalid URL format", () => {
    const result = validateWebhookUrl("not-a-url");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Invalid URL");
  });
});
