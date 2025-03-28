# Implementation Plan: Custom Argument Parser and Help System

**Goal:** Implement a custom system for defining, parsing, and providing help for command parameters in the format `--name=value` or `--flag`, triggered by a help flag like `--?`, without external dependencies like `deno-cliffy`.

**Affected Components:**

*   `src/commands/types.ts`: Interface definitions.
*   `src/commands/Registry.ts`: Core command execution and suggestion logic.
*   `src/commands/parser.ts`: (New file) Custom argument parsing logic.
*   `src/example/server.shell.ts`: Example command implementations.
*   `memory-bank/`: Documentation files (ADR, System Patterns, etc.).

---

## Implementation Phases

**Phase 1: Define Parameter Structure**

1.  **Modify `src/commands/types.ts`**:
    *   Define a new interface `ParameterDefinition`:
        ```typescript
        export interface ParameterDefinition {
          name: string; // e.g., "string", "verbose"
          description: string;
          type: 'string' | 'boolean' | 'number'; // Extend as needed
          required?: boolean;
          alias?: string; // e.g., "s" for "--string"
          isFlag?: boolean; // True if it's a boolean flag like --verbose
          // Add default value later if needed
        }
        ```
    *   Add an optional `parameters` array to the `Command` interface:
        ```typescript
        export interface Command {
          // ... existing properties ...
          parameters?: ParameterDefinition[];
          // ... existing properties ...
        }
        ```

**Phase 2: Implement Argument Parser**

1.  **Create `src/commands/parser.ts`**: This new file will contain the parsing logic.
2.  **Define `ParsedArguments` Interface** (in `parser.ts` or `types.ts`):
    ```typescript
    export interface ParsedArguments {
      options: Record<string, string | boolean | number>; // Parsed options { name: value }
      positional: string[]; // Arguments not matching options
      errors: string[]; // List of parsing errors
      helpRequested?: boolean; // Flag if help was requested
    }
    ```
3.  **Implement `parseArguments` Function** (in `parser.ts`):
    *   Signature: `export function parseArguments(rawArgs: string[], paramDefs: ParameterDefinition[] = []): ParsedArguments`
    *   **Logic:**
        *   Initialize empty `options`, `positional`, `errors`, `helpRequested`.
        *   Iterate through `rawArgs`.
        *   Check for help flags (`--?`, `--help`, potentially `-h` if defined in alias). Set `helpRequested = true` and potentially stop further parsing.
        *   Check if an arg matches `--name=value`, `--name value`, `-a value` (based on `paramDefs`).
            *   Validate against `paramDefs` (known option? correct type expected?).
            *   Handle flags (`isFlag: true`).
            *   Populate `options` record. Add errors if validation fails.
        *   If an arg doesn't match an option format, add it to `positional`.
        *   After loop, check if all `required` parameters (from `paramDefs`) were found in `options`. Add errors if not.
    *   **Return:** The populated `ParsedArguments` object.

**Phase 3: Integrate Parser into Execution**

1.  **Modify `src/commands/Registry.ts` (`executeCommand` method):**
    *   Import `parseArguments` and `ParsedArguments`.
    *   After identifying the `commandToExecute` and extracting `currentArgs` (the raw argument strings):
        *   Call `parseArguments(currentArgs, commandToExecute.parameters)`.
        *   Check `parsedArgs.errors`. If errors exist, format and display them using `context.write`, then return `{ success: false, error: ... }`.
        *   Check `parsedArgs.helpRequested`. If true, call the help generation function (from Phase 5), write the output, and return `{ success: true }`.
    *   Decide how to pass `parsedArgs` to the `action`. Either update the `CommandContext` or change the `action` signature itself (preferred, see Phase 4).

**Phase 4: Update Command Action Signature & Implementations**

1.  **Modify `src/commands/types.ts`**: Update the `action` signature within the `Command` interface:
    ```typescript
    action: (context: CommandContext, parsedArgs: ParsedArguments) => void | Promise<void>;
    ```
2.  **Refactor Existing Commands** (e.g., `echoNormalCommand`, `echoReverseCommand` in `src/example/server.shell.ts`):
    *   Update their `action` function signatures to accept `parsedArgs: ParsedArguments`.
    *   Access parameters via `parsedArgs.options` or `parsedArgs.positional` instead of the raw string array.
    *   Define `parameters` array in their `Command` definition object. For `echo reverse --string=value`:
        ```typescript
        parameters: [
          { name: 'string', description: 'The text to echo', type: 'string', required: true, alias: 's' }
        ]
        ```

**Phase 5: Implement Help Generation**

1.  **Modify `src/commands/Registry.ts`**:
    *   Implement a new private method `_generateHelp(command: Command): string`.
    *   **Logic:**
        *   Start with `command.name` and `command.description`.
        *   Format a "Usage" line (e.g., `Usage: command [options] [subcommands]`).
        *   List defined `parameters` with alias, type, description, required status.
        *   List available `subcommands` with their descriptions.
    *   Update `executeCommand` (from Phase 3) to call `this._generateHelp(commandToExecute)` and `context.write` the result when `parsedArgs.helpRequested` is true.
2.  **Enhance `help` Command:** The built-in `help` command could potentially be updated to call `_generateHelp` if an argument matching a command name is provided (e.g., `help echo`).

**Phase 6: Documentation (Post-Implementation)**

1.  **Create ADR:** Add a new ADR in `memory-bank/decisionLog.md` documenting the decision to build a custom parser/help system instead of using `deno-cliffy`, outlining the reasons (avoiding dependencies) and the chosen approach.
2.  **Update System Patterns:** Add/update sections in `memory-bank/systemPatterns.md` describing the new `ParameterDefinition` structure, the `parseArguments` function pattern, and the help generation approach.
3.  **Update Product Context:** Revise `memory-bank/productContext.md` to remove mentions of `deno-cliffy` as the command parser, referencing the new custom system instead.
4.  **Update Progress:** Add tasks for each phase to `memory-bank/progress.md`.

---

## Diagram (Simplified Flow)

```mermaid
graph TD
    A[Input Received in Shell] --> B{handleInputData};
    B -- Enter --> C{executeCurrentBuffer};
    C --> D[CommandRegistry.executeCommand];
    D --> E{Find Command/Subcommand};
    E --> F[Extract Raw Args];
    F --> G[parser.parseArguments];
    G --> H{Check Errors};
    H -- Errors --> I[Display Error & Exit];
    H -- No Errors --> J{Check Help Requested};
    J -- Yes --> K[Registry._generateHelp];
    K --> L[Display Help & Exit];
    J -- No --> M[Command.action(context, parsedArgs)];
    M --> N[Action Logic];
    N --> O[Write Output];
