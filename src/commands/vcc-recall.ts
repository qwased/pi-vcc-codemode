import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseCommandRequest } from "../core/recall-request";
import { openRecallView, runRecall, type RecallPagingHints } from "../core/recall-run";

const scopeArg = (scope: string) => (scope === "all" ? " scope:all" : "");

const COMMAND_PAGING_HINTS: RecallPagingHints = {
  outOfRange: (query, scope, totalPages, truncated) =>
    `Use /pi-vcc-recall ${query}${scopeArg(scope)} page:N with N between 1 and ${totalPages}` +
    (truncated ? "." : ", or refine your query."),
  nextPage: (query, scope, page) => `\n--- /pi-vcc-recall ${query}${scopeArg(scope)} page:${page} ---`,
  scanNext: (query, cursor, scope) =>
    `\n--- /pi-vcc-recall scan:true cursor:${cursor}${scopeArg(scope)} ${query} ---`,
  readNext: (index, offset, length, scope) =>
    `\n--- /pi-vcc-recall read:${index} offset:${offset} length:${length}${scopeArg(scope)} ---`,
};

export const registerVccRecallCommand = (pi: ExtensionAPI) => {
  pi.registerCommand("pi-vcc-recall", {
    description: "Recall earlier parts of this session. Plain keywords work best; add scope:all to reach edited or retried turns.",
    handler: async (args: string, ctx) => {
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile) {
        ctx.ui.notify("No session file available.", "error");
        return;
      }
      const request = parseCommandRequest(args);
      const view = openRecallView(sessionFile, request.scope, ctx.sessionManager);
      const content = runRecall(request, view, COMMAND_PAGING_HINTS);
      pi.sendMessage({ customType: "vcc-recall", content, display: true }, { triggerTurn: true });
    },
  });
};
