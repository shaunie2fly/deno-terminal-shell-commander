import { OutputTransformer } from "./stream.ts";
import { formatSuccess, formatInfo, formatWarning, formatError } from "../colors.ts";

/**
 * Basic text transformer that applies string transformations
 */
export class TextTransformer implements OutputTransformer {
  private transformFn: (text: string) => string;

  constructor(transformFn: (text: string) => string) {
    this.transformFn = transformFn;
  }

  transform(data: string): string {
    return this.transformFn(data);
  }
}

/**
 * Color transformer for applying ANSI colors
 */
export class ColorTransformer implements OutputTransformer {
  private formatFn: (text: string) => string;

  constructor(formatFn: (text: string) => string) {
    this.formatFn = formatFn;
  }

  transform(data: string): string {
    return this.formatFn(data);
  }
}

/**
 * Error transformer for formatting error messages
 */
export class ErrorTransformer implements OutputTransformer {
  private title: string;
  private hint?: string;

  constructor(title: string, hint?: string) {
    this.title = title;
    this.hint = hint;
  }

  transform(data: string): string {
    return formatError(this.title, data, this.hint);
  }
}

/**
 * Prefix transformer for adding prefixes to lines
 */
export class PrefixTransformer implements OutputTransformer {
  private prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  transform(data: string): string {
    return data.split("\n")
      .map(line => `${this.prefix}${line}`)
      .join("\n");
  }
}

/**
 * Filter transformer for filtering lines based on pattern
 */
export class FilterTransformer implements OutputTransformer {
  private pattern: RegExp;
  private include: boolean;

  constructor(pattern: RegExp, include = true) {
    this.pattern = pattern;
    this.include = include;
  }

  transform(data: string): string {
    return data.split("\n")
      .filter(line => this.pattern.test(line) === this.include)
      .join("\n");
  }
}

/**
 * Timestamp transformer for adding timestamps to lines
 */
export class TimestampTransformer implements OutputTransformer {
  transform(data: string): string {
    const timestamp = new Date().toISOString();
    return data.split("\n")
      .map(line => `[${timestamp}] ${line}`)
      .join("\n");
  }
}

// Common transformer instances
export const errorTransformer = new ErrorTransformer("Error");
export const warningTransformer = new ColorTransformer(formatWarning);
export const successTransformer = new ColorTransformer(formatSuccess);
export const infoTransformer = new ColorTransformer(formatInfo);

export const timestampTransformer = new TimestampTransformer();
export const debugPrefix = new PrefixTransformer("[DEBUG] ");
export const errorPrefix = new PrefixTransformer("[ERROR] ");
export const warnPrefix = new PrefixTransformer("[WARN] ");