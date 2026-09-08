"use client";

import { AuditLogs } from "./audit-logs";

export default function WorkspaceSecurityClient() {
  return (
    <div className="flex flex-col gap-6">
      <AuditLogs />
    </div>
  );
}
