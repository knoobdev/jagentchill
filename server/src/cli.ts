import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type CommandLine = {
  name: "serve" | "devices add-admin";
  dataDir?: string;
  port?: number;
  publicKey?: string;
  localSupervisor: boolean;
  keyProtection?: string;
};

/** `serve [--data-dir <dir>] [--port <port>]` (the default) and `devices add-admin --public-key <key> [--local-supervisor]`. */
export function parseCommandLine(args: readonly string[]): CommandLine {
  const words: string[] = [];
  const out: CommandLine = { name: "serve", localSupervisor: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => {
      const next = args[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--data-dir") out.dataDir = value();
    else if (arg === "--port") {
      const port = Number(value());
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port needs a port number");
      out.port = port;
    } else if (arg === "--public-key") out.publicKey = value();
    else if (arg === "--key-protection") out.keyProtection = value();
    else if (arg === "--local-supervisor") out.localSupervisor = true;
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else words.push(arg);
  }
  const name = words.join(" ");
  if (name === "" || name === "serve") return out;
  if (name === "devices add-admin") {
    if (!out.publicKey) throw new Error("devices add-admin needs --public-key");
    return { ...out, name };
  }
  throw new Error(`unknown command "${name}"`);
}

/** Asks the running server of `dataDir` to make a key an admin device, through its endpoint for this machine. Returns the exit code. */
export async function runAddAdmin(dataDir: string, command: CommandLine): Promise<number> {
  const runFile = join(dataDir, "run", "server.json"), tokenFile = join(dataDir, "secrets", "local-admin");
  if (!existsSync(runFile) || !existsSync(tokenFile)) {
    console.error("No JAgentChill Server is running on this data directory.");
    return 1;
  }
  const { port } = JSON.parse(readFileSync(runFile, "utf8")) as { port: number };
  const response = await fetch(`http://127.0.0.1:${port}/jagentchill/v1/local-admin/devices/add-admin`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${readFileSync(tokenFile, "utf8")}` },
    body: JSON.stringify({ publicKey: command.publicKey, localSupervisor: command.localSupervisor, ...(command.keyProtection ? { keyProtection: command.keyProtection } : {}) }),
  }).catch(() => null);
  if (!response?.ok) {
    console.error(`The server did not accept the request${response ? ` (HTTP ${response.status})` : ""}.`);
    return 1;
  }
  console.log(JSON.stringify(await response.json()));
  return 0;
}
