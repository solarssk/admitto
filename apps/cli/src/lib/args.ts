export class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function arg(name: string, argv: string[] = process.argv): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = argv[i + 1];
  if (!next || next.startsWith("-")) {
    throw new CliError(`Missing value for --${name}`);
  }
  return next;
}

const SHORT_FLAG_ALIASES: Record<string, string[]> = {
  yes: ["y"],
};

export function hasFlag(name: string, argv: string[] = process.argv): boolean {
  if (argv.includes(`--${name}`)) return true;
  const shorts = SHORT_FLAG_ALIASES[name];
  return shorts?.some((s) => argv.includes(`-${s}`)) ?? false;
}

export function parseFormat(argv: string[] = process.argv): "table" | "json" {
  const raw = arg("format", argv);
  if (raw === "json") return "json";
  if (raw && raw !== "table") {
    throw new CliError("--format must be table or json");
  }
  return "table";
}
