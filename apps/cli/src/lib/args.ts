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
  return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
}

export function hasFlag(name: string, argv: string[] = process.argv): boolean {
  return argv.includes(`--${name}`) || argv.includes(`-${name.charAt(0)}`);
}

export function parseFormat(argv: string[] = process.argv): "table" | "json" {
  const raw = arg("format", argv);
  if (raw === "json") return "json";
  if (raw && raw !== "table") {
    throw new CliError("--format must be table or json");
  }
  return "table";
}
