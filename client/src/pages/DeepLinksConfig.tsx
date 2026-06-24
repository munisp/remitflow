/**
 * DeepLinksConfig.tsx — Universal Links (iOS) + App Links (Android) configuration
 *
 * Manages deep link routing for:
 * - Transfer status: remitflow://transfers/:id
 * - KYC resume: remitflow://kyc/resume
 * - Payment links: remitflow://pay/:code
 * - Notification actions: remitflow://notifications/:id
 * - Referral: remitflow://refer/:code
 */

import React, { useEffect, useState } from "react";

interface DeepLinkRoute {
  pattern: string;
  description: string;
  example: string;
  iosUniversalLink: string;
  androidAppLink: string;
  webFallback: string;
}

const DEEP_LINK_ROUTES: DeepLinkRoute[] = [
  {
    pattern: "/transfers/:id",
    description: "View transfer status and details",
    example: "remitflow://transfers/tx_abc123",
    iosUniversalLink: "https://app.remitflow.com/transfers/:id",
    androidAppLink: "https://app.remitflow.com/transfers/:id",
    webFallback: "/transfers/:id",
  },
  {
    pattern: "/kyc/resume",
    description: "Resume KYC verification flow",
    example: "remitflow://kyc/resume",
    iosUniversalLink: "https://app.remitflow.com/kyc/resume",
    androidAppLink: "https://app.remitflow.com/kyc/resume",
    webFallback: "/kyc",
  },
  {
    pattern: "/pay/:code",
    description: "Open payment link for P2P transfer",
    example: "remitflow://pay/PAY_xyz789",
    iosUniversalLink: "https://app.remitflow.com/pay/:code",
    androidAppLink: "https://app.remitflow.com/pay/:code",
    webFallback: "/pay/:code",
  },
  {
    pattern: "/refer/:code",
    description: "Accept referral invitation",
    example: "remitflow://refer/REF_abc",
    iosUniversalLink: "https://app.remitflow.com/refer/:code",
    androidAppLink: "https://app.remitflow.com/refer/:code",
    webFallback: "/referral/:code",
  },
  {
    pattern: "/wallet/topup",
    description: "Quick top-up from notification",
    example: "remitflow://wallet/topup",
    iosUniversalLink: "https://app.remitflow.com/wallet/topup",
    androidAppLink: "https://app.remitflow.com/wallet/topup",
    webFallback: "/wallet",
  },
  {
    pattern: "/notifications/:id",
    description: "Open specific notification action",
    example: "remitflow://notifications/notif_123",
    iosUniversalLink: "https://app.remitflow.com/notifications/:id",
    androidAppLink: "https://app.remitflow.com/notifications/:id",
    webFallback: "/notifications",
  },
];

// iOS apple-app-site-association
const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    apps: [],
    details: [
      {
        appID: "TEAMID.com.remitflow.app",
        paths: ["/transfers/*", "/kyc/*", "/pay/*", "/refer/*", "/wallet/*", "/notifications/*"],
      },
    ],
  },
  webcredentials: {
    apps: ["TEAMID.com.remitflow.app"],
  },
};

// Android assetlinks.json
const ANDROID_ASSET_LINKS = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.remitflow.app",
      sha256_cert_fingerprints: ["${ANDROID_SIGNING_CERT_SHA256}"],
    },
  },
];

export default function DeepLinksConfig() {
  const [activeTab, setActiveTab] = useState<"routes" | "ios" | "android" | "testing">("routes");

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Deep Links Configuration
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Universal Links (iOS) + App Links (Android) for seamless app-to-web routing
        </p>

        {/* Tab Navigation */}
        <div className="flex space-x-1 bg-gray-200 dark:bg-gray-800 rounded-lg p-1 mb-6">
          {(["routes", "ios", "android", "testing"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition ${
                activeTab === tab
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow"
                  : "text-gray-600 dark:text-gray-400"
              }`}
            >
              {tab === "routes" ? "Routes" : tab === "ios" ? "iOS Config" : tab === "android" ? "Android Config" : "Testing"}
            </button>
          ))}
        </div>

        {/* Routes Tab */}
        {activeTab === "routes" && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Pattern</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Description</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Example</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {DEEP_LINK_ROUTES.map((route) => (
                  <tr key={route.pattern}>
                    <td className="px-4 py-3 font-mono text-sm text-blue-600 dark:text-blue-400">{route.pattern}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{route.description}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-500">{route.example}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* iOS Config Tab */}
        {activeTab === "ios" && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                apple-app-site-association
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Place at <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">/.well-known/apple-app-site-association</code>
              </p>
              <pre className="bg-gray-900 text-green-400 p-4 rounded-lg text-xs overflow-auto max-h-80">
                {JSON.stringify(APPLE_APP_SITE_ASSOCIATION, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {/* Android Config Tab */}
        {activeTab === "android" && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                assetlinks.json
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Place at <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">/.well-known/assetlinks.json</code>
              </p>
              <pre className="bg-gray-900 text-green-400 p-4 rounded-lg text-xs overflow-auto max-h-80">
                {JSON.stringify(ANDROID_ASSET_LINKS, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {/* Testing Tab */}
        {activeTab === "testing" && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Deep Link Testing
            </h3>
            <DeepLinkTester />
          </div>
        )}
      </div>
    </div>
  );
}

function DeepLinkTester() {
  const [testUrl, setTestUrl] = useState("");
  const [result, setResult] = useState<{ platform: string; resolved: string; status: string } | null>(null);

  const testDeepLink = () => {
    const resolved = resolveDeepLink(testUrl);
    setResult(resolved);
  };

  return (
    <div className="space-y-4">
      <div className="flex space-x-2">
        <input
          type="text"
          value={testUrl}
          onChange={(e) => setTestUrl(e.target.value)}
          placeholder="remitflow://transfers/tx_abc123"
          className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        />
        <button
          onClick={testDeepLink}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Test
        </button>
      </div>
      {result && (
        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-500 dark:text-gray-400">Platform:</span>
              <p className="font-medium text-gray-900 dark:text-white">{result.platform}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Resolved Path:</span>
              <p className="font-mono text-gray-900 dark:text-white">{result.resolved}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Status:</span>
              <p className={`font-medium ${result.status === "valid" ? "text-green-600" : "text-red-600"}`}>
                {result.status}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function resolveDeepLink(url: string): { platform: string; resolved: string; status: string } {
  const platform = /^remitflow:\/\//.test(url) ? "native" : /^https:\/\/app\.remitflow\.com/.test(url) ? "universal" : "web";
  const path = url.replace(/^(remitflow:\/\/|https:\/\/app\.remitflow\.com)/, "");

  for (const route of DEEP_LINK_ROUTES) {
    const regex = new RegExp("^" + route.pattern.replace(/:[^/]+/g, "[^/]+") + "$");
    if (regex.test("/" + path)) {
      return { platform, resolved: "/" + path, status: "valid" };
    }
  }

  return { platform, resolved: "/" + path, status: "no_match" };
}
