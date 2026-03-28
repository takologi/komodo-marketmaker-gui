import "server-only";

import { NextRequest } from "next/server";

import { isAuthorizedRestartToken } from "@/lib/system/restart";

export function isAuthorizedKcbWrite(request: NextRequest): boolean {
  const headerToken = request.headers.get("x-admin-token");
  return isAuthorizedRestartToken(headerToken);
}
