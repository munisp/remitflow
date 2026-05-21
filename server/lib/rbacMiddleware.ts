/**
 * RBAC enforcement middleware — P1 Security 5.7
 * Verifies admin role on admin routes.
 */

type UserRole = "user" | "admin" | "super_admin" | "compliance_officer" | "support_agent";

interface RbacUser {
  id: number;
  role?: string;
  permissions?: string[];
}

const ROLE_HIERARCHY: Record<UserRole, number> = {
  user: 0,
  support_agent: 1,
  compliance_officer: 2,
  admin: 3,
  super_admin: 4,
};

const ROUTE_PERMISSIONS: Record<string, { minRole: UserRole; permissions?: string[] }> = {
  "admin.*": { minRole: "admin" },
  "system.heartbeat*": { minRole: "admin" },
  "compliance.*": { minRole: "compliance_officer" },
  "kyc.approve": { minRole: "compliance_officer", permissions: ["kyc.approve"] },
  "kyc.reject": { minRole: "compliance_officer", permissions: ["kyc.reject"] },
  "transfer.approve": { minRole: "admin", permissions: ["transfer.approve"] },
  "user.role.change": { minRole: "super_admin" },
  "user.delete": { minRole: "super_admin" },
  "system.config.*": { minRole: "super_admin" },
};

export function checkRbac(
  user: RbacUser,
  route: string
): { allowed: boolean; reason?: string } {
  const userRole = (user.role as UserRole) ?? "user";
  const userLevel = ROLE_HIERARCHY[userRole] ?? 0;

  for (const [pattern, requirement] of Object.entries(ROUTE_PERMISSIONS)) {
    const matches = pattern.endsWith("*")
      ? route.startsWith(pattern.slice(0, -1))
      : route === pattern;

    if (matches) {
      const requiredLevel = ROLE_HIERARCHY[requirement.minRole] ?? 0;
      if (userLevel < requiredLevel) {
        return {
          allowed: false,
          reason: `Route ${route} requires ${requirement.minRole} role (user has ${userRole})`,
        };
      }

      if (requirement.permissions) {
        const userPerms = user.permissions ?? [];
        const missing = requirement.permissions.filter((p) => !userPerms.includes(p));
        if (missing.length > 0) {
          return {
            allowed: false,
            reason: `Missing permissions: ${missing.join(", ")}`,
          };
        }
      }

      return { allowed: true };
    }
  }

  return { allowed: true };
}

export function isAdmin(user: RbacUser): boolean {
  return (ROLE_HIERARCHY[(user.role as UserRole) ?? "user"] ?? 0) >= ROLE_HIERARCHY.admin;
}

export function hasPermission(user: RbacUser, permission: string): boolean {
  return user.permissions?.includes(permission) ?? false;
}
