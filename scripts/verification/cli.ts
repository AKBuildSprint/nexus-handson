export interface CliArguments {
  command: string;
  values: Record<string, string>;
  flags: Set<string>;
}

export function parseCliArguments(argv: string[]): CliArguments {
  const [command = '', ...rest] = argv;
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected positional argument: ${token}`);
    const name = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      flags.add(name);
      continue;
    }
    if (values[name] !== undefined || flags.has(name)) throw new Error(`Duplicate argument --${name}.`);
    values[name] = next;
    index += 1;
  }
  return { command, values, flags };
}

export function requireArgument(arguments_: CliArguments, name: string): string {
  const value = arguments_.values[name];
  if (!value) throw new Error(`Missing required --${name}.`);
  return value;
}
