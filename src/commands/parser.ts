/**
 * Custom argument parser for the shell command system.
 * Parses raw argument strings based on command parameter definitions.
 * @module
 */

import type { ParameterDefinition } from './types.ts'; // Import needed type

/**
 * Structure holding the results of argument parsing.
 */
export interface ParsedArguments {
  /** Parsed options/flags: { name: value } */
  options: Record<string, string | boolean | number>;
  /** Arguments not matching defined options/flags */
  positional: string[];
  /** List of parsing errors encountered */
  errors: string[];
  /** Flag indicating if a help option (e.g., --?, --help) was detected */
  helpRequested?: boolean;
}

/**
 * Parses raw argument strings into structured options and positional arguments
 * based on the provided parameter definitions.
 *
 * Supports:
 *   --name=value
 *   --name value
 *   --flag (boolean true)
 *   -a value (if alias 'a' is defined)
 *   -f (boolean true if alias 'f' is defined as a flag)
 *   --? or --help triggers helpRequested flag
 *
 * @param rawArgs - Array of raw string arguments (excluding command/subcommand names).
 * @param paramDefs - Array of ParameterDefinition objects for the specific command.
 * @returns A ParsedArguments object.
 */
export function parseArguments(rawArgs: string[], paramDefs: ParameterDefinition[] = []): ParsedArguments {
  const result: ParsedArguments = {
    options: {},
    positional: [],
    errors: [],
    helpRequested: false,
  };

  // --- Precompute lookups for efficiency ---
  const defsByName: Map<string, ParameterDefinition> = new Map();
  const defsByAlias: Map<string, ParameterDefinition> = new Map();
  const requiredParams: Set<string> = new Set();

  for (const def of paramDefs) {
    defsByName.set(def.name, def);
    if (def.alias) {
      defsByAlias.set(def.alias, def);
    }
    if (def.required && !def.isFlag) { // Flags cannot be logically 'required' in the same way as value options
      requiredParams.add(def.name);
    }
  }
  // ---

  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i];

    // --- Check for Help Flags ---
    if (arg === '--?' || arg === '--help') {
      result.helpRequested = true;
      // We can stop parsing here if help is requested, as other args become irrelevant
      break;
      // i++; // No longer needed if we break
      // continue; // No longer needed if we break
    }

    // --- Check Long Options (`--name=value` or `--name`) ---
    if (arg.startsWith('--')) {
      let optionName = arg.substring(2);
      let value: string | boolean | number | undefined = undefined;
      const equalsIndex = optionName.indexOf('=');

      if (equalsIndex !== -1) {
        // Format: --name=value
        value = optionName.substring(equalsIndex + 1);
        optionName = optionName.substring(0, equalsIndex);
      }

      const def = defsByName.get(optionName);

      if (!def) {
        result.errors.push(`Unknown option: --${optionName}`);
        i++;
        continue;
      }

      if (def.isFlag) {
        if (value !== undefined) {
          result.errors.push(`Option --${optionName} is a flag and does not accept a value.`);
        } else {
          result.options[def.name] = true;
        }
      } else {
        // Expects a value
        if (value === undefined) {
          // Check next arg: --name value
          if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('-')) {
            value = rawArgs[i + 1];
            i++; // Consume the value argument
          } else {
            result.errors.push(`Option --${optionName} requires a value.`);
            i++; // Move past the option name
            continue;
          }
        }
        // TODO: Add type conversion/validation based on def.type (string, number)
        result.options[def.name] = value; // Store as string for now
      }
      i++;
      continue;
    }

    // --- Check Short Options (`-a value` or `-f`) ---
    if (arg.startsWith('-') && !arg.startsWith('--')) {
      const alias = arg.substring(1);
      // TODO: Handle combined flags like -abc later if needed. For now, one alias per arg.
      if (alias.length !== 1) {
        result.errors.push(`Invalid short option format: ${arg}. Use single character aliases.`);
        i++;
        continue;
      }

      const def = defsByAlias.get(alias);

      if (!def) {
        result.errors.push(`Unknown option alias: -${alias}`);
        i++;
        continue;
      }

      if (def.isFlag) {
        result.options[def.name] = true;
      } else {
        // Expects a value
        if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('-')) {
          const value = rawArgs[i + 1];
          // TODO: Add type conversion/validation based on def.type
          result.options[def.name] = value; // Store as string
          i++; // Consume the value argument
        } else {
          result.errors.push(`Option -${alias} (--${def.name}) requires a value.`);
        }
      }
      i++;
      continue;
    }

    // --- Positional Argument ---
    result.positional.push(arg);
    i++;
  } // End while loop

  // --- Post-parsing Validation (Skip if help was requested) ---
  if (!result.helpRequested) {
    for (const required of requiredParams) {
      if (!(required in result.options)) {
        result.errors.push(`Missing required option: --${required}`);
      }
    }
  } // End if (!result.helpRequested)

  return result;
} // End parseArguments function