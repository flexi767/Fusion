import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, statSync, existsSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import {
  writeSessionHookScripts,
  cleanupSessionHookDir,
  buildHookScriptContent,
  buildNotifyShimContent,
  HOOK_SCRIPT_NAMES,
} from "../hook-scripts.js";

describe("hook-scripts", () => {
  let tmpDir: string;
  let dir: string;
  it("preserves project routing when both native hook forms append an event query", async () => {
    const bin = join(tmpDir, "bin"); await mkdir(bin);
    const capture = join(tmpDir, "request-args");
    await writeFile(join(bin, "curl"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$TEST_CAPTURE"\ncat >/dev/null\n', { mode: 0o700 });
    const scripts = await writeSessionHookScripts({ sessionId: "owned", token: "test-token", endpointUrl: "http://127.0.0.1:12345/api/cli-agent/hooks?projectId=project-other", dir });
    for (const [path, event] of [[scripts.hookScriptPath, "SessionStart"], [scripts.notifyScriptPath, "notify"]]) {
      await promisify(execFile)("sh", ["-c", 'exec "$1" "$2" </dev/null', "sh", path, "{}"], { env: { PATH: `${bin}:/usr/bin:/bin`, TEST_CAPTURE: capture, FUSION_HOOK_EVENT: "SessionStart" }, timeout: 2000 });
      const args = (await readFile(capture, "utf8")).split("\n");
      const url = new URL(args[args.indexOf("POST") + 1]);
      expect(url.searchParams.get("projectId")).toBe("project-other"); expect(url.searchParams.get("event")).toBe(event);
    }
  });

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "fusion-hook-scripts-"));
    dir = join(tmpDir, "session-config");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const opts = {
    sessionId: "sess-123",
    token: "abc123def456token",
    endpointUrl: "http://127.0.0.1:4040/api/cli-agent/hooks",
  };

  describe("buildHookScriptContent", () => {
    it("POSTs to the endpoint URL with the token + session headers", () => {
      const script = buildHookScriptContent(opts);
      expect(script).toContain("http://127.0.0.1:4040/api/cli-agent/hooks");
      expect(script).toContain("X-Fusion-Cli-Session-Token: $TOKEN");
      expect(script).toContain("X-Fusion-Cli-Session-Id: $SESSION_ID");
      expect(script).toContain("abc123def456token");
      expect(script).toContain("sess-123");
    });

    it("uses curl with short timeouts and always exits 0", () => {
      const script = buildHookScriptContent(opts);
      expect(script).toContain("curl");
      expect(script).toContain("--connect-timeout");
      expect(script).toContain("--max-time");
      // Failure tolerance: the curl line is `|| true` and the script ends `exit 0`.
      expect(script).toContain("|| true");
      expect(script.trimEnd().endsWith("exit 0")).toBe(true);
    });

    it("never sets an Origin header (CSRF-safe)", () => {
      const script = buildHookScriptContent(opts);
      expect(script.toLowerCase()).not.toContain("origin:");
    });

    it("starts with a sh shebang", () => {
      expect(buildHookScriptContent(opts).startsWith("#!/bin/sh")).toBe(true);
    });

    it("shell-escapes a token containing a single quote", () => {
      const script = buildHookScriptContent({ ...opts, token: "to'ken" });
      // The single quote is escaped via the '\'' idiom — no raw unbalanced quote.
      expect(script).toContain(`'\\''`);
    });
  });

  describe("buildNotifyShimContent", () => {
    it("forwards argv[1] (else stdin) and exits 0", () => {
      const script = buildNotifyShimContent(opts);
      expect(script.startsWith("#!/bin/sh")).toBe(true);
      expect(script).toContain('"$1"');
      expect(script).toContain("event=notify");
      expect(script).toContain("X-Fusion-Cli-Session-Token: $TOKEN");
      expect(script.trimEnd().endsWith("exit 0")).toBe(true);
    });
  });

  describe("writeSessionHookScripts", () => {
    it("writes both scripts into the dir, marked executable", async () => {
      const result = await writeSessionHookScripts({ ...opts, dir });

      expect(result.hookScriptPath).toBe(join(dir, HOOK_SCRIPT_NAMES.hook));
      expect(result.notifyScriptPath).toBe(join(dir, HOOK_SCRIPT_NAMES.notify));
      expect(existsSync(result.hookScriptPath)).toBe(true);
      expect(existsSync(result.notifyScriptPath)).toBe(true);

      // Owner-executable bit set on both files.
      const hookMode = statSync(result.hookScriptPath).mode;
      const notifyMode = statSync(result.notifyScriptPath).mode;
      expect(hookMode & 0o100).toBe(0o100);
      expect(notifyMode & 0o100).toBe(0o100);

      const hookContent = await readFile(result.hookScriptPath, "utf8");
      expect(hookContent).toContain(opts.endpointUrl);
      expect(hookContent).toContain(opts.token);
    });

    it("creates the dir if it does not exist", async () => {
      expect(existsSync(dir)).toBe(false);
      await writeSessionHookScripts({ ...opts, dir });
      expect(existsSync(dir)).toBe(true);
    });
  });

  describe("cleanupSessionHookDir", () => {
    it("removes the dir and its contents", async () => {
      await writeSessionHookScripts({ ...opts, dir });
      expect(existsSync(dir)).toBe(true);

      await cleanupSessionHookDir(dir);
      expect(existsSync(dir)).toBe(false);
    });

    it("is a no-op for a missing dir (never throws)", async () => {
      await expect(cleanupSessionHookDir(join(tmpDir, "does-not-exist"))).resolves.toBeUndefined();
    });
  });
});
