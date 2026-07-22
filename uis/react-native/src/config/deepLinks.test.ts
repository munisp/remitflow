import {
  DEEP_LINK_PREFIX,
  UNIVERSAL_LINK_PREFIX,
  linking,
  parseDeepLink,
} from "./deepLinks";

describe("mobile deep-link configuration", () => {
  it("resolves transfer identifiers from the custom scheme", () => {
    expect(parseDeepLink(`${DEEP_LINK_PREFIX}transfer/trf_123`)).toEqual({
      screen: "TransferDetails",
      params: { id: "trf_123" },
    });
  });

  it("resolves notification routes from the universal-link origin", () => {
    expect(parseDeepLink(`${UNIVERSAL_LINK_PREFIX}/notifications/evt_456`)).toEqual({
      screen: "NotificationDetail",
      params: { id: "evt_456" },
    });
  });

  it("returns null for unregistered links and exposes the registered screen map", () => {
    expect(parseDeepLink(`${DEEP_LINK_PREFIX}unregistered/path`)).toBeNull();
    expect(linking.config.screens.TransferDetails).toBe("/transfer/:id");
    expect(linking.prefixes).toEqual([DEEP_LINK_PREFIX, UNIVERSAL_LINK_PREFIX]);
  });
});
