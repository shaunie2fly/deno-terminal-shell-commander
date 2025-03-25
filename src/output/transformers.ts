import { OutputTransformer } from './stream.ts';
import { formatError, formatInfo, formatSuccess, formatWarning } from '../colors.ts';

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
		return data.split('\n')
			.map((line) => `${this.prefix}${line}`)
			.join('\n');
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
		return data.split('\n')
			.filter((line) => this.pattern.test(line) === this.include)
			.join('\n');
	}
}

/**
 * Timestamp transformer for adding timestamps to lines
 */
export class TimestampTransformer implements OutputTransformer {
	transform(data: string): string {
		const timestamp = new Date().toISOString();
		return data.split('\n')
			.map((line) => `[${timestamp}] ${line}`)
			.join('\n');
	}
}

// Common transformer instances
export const errorTransformer = new ErrorTransformer('Error');
export const warningTransformer = new ColorTransformer(formatWarning);
export const successTransformer = new ColorTransformer(formatSuccess);
export const infoTransformer = new ColorTransformer(formatInfo);

export const timestampTransformer = new TimestampTransformer();
export const debugPrefix = new PrefixTransformer('[DEBUG] ');
export const errorPrefix = new PrefixTransformer('[ERROR] ');
export const warnPrefix = new PrefixTransformer('[WARN] ');

/**
 * Output Transformers for Shell Output
 *
 * Provides transformer implementations for processing shell output
 * @module
 */

/**
 * Create a transformer that strips ANSI color codes
 * @returns Transform stream that removes ANSI color codes
 */
export function createColorStripTransformer(): TransformStream<string, string> {
	return new TransformStream({
		transform(chunk, controller) {
			// Strip ANSI color codes
			const stripped = chunk.replace(/\x1b\[\d+(;\d+)*m/g, '');
			controller.enqueue(stripped);
		},
	});
}

/**
 * Create a transformer that trims whitespace
 * @returns Transform stream that trims whitespace
 */
export function createTrimTransformer(): TransformStream<string, string> {
	return new TransformStream({
		transform(chunk, controller) {
			// Trim whitespace
			const trimmed = chunk.trim();
			controller.enqueue(trimmed);
		},
	});
}

/**
 * Create a transformer that truncates output to a maximum length
 * @param maxLength - Maximum length of output
 * @param suffix - Suffix to append when truncated (default: "...")
 * @returns Transform stream that truncates output
 */
export function createTruncateTransformer(
	maxLength: number,
	suffix = '...',
): TransformStream<string, string> {
	return new TransformStream({
		transform(chunk, controller) {
			// Truncate if longer than maxLength
			if (chunk.length > maxLength) {
				const truncated = chunk.substring(0, maxLength - suffix.length) + suffix;
				controller.enqueue(truncated);
			} else {
				controller.enqueue(chunk);
			}
		},
	});
}

/**
 * Create a transformer that adds line numbers
 * @param startLine - Line number to start with (default: 1)
 * @param padding - Number of digits to pad line numbers (default: 3)
 * @returns Transform stream that adds line numbers
 */
export function createLineNumberTransformer(
	startLine = 1,
	padding = 3,
): TransformStream<string, string> {
	let lineNumber = startLine;

	return new TransformStream({
		transform(chunk, controller) {
			// Split by line breaks
			const lines = chunk.split(/\r\n|\r|\n/);
			const numberedLines = lines.map((line) => {
				// Skip empty lines at the end
				if (line === '' && lines.indexOf(line) === lines.length - 1) {
					return '';
				}
				return `${String(lineNumber++).padStart(padding, ' ')} | ${line}`;
			});

			controller.enqueue(numberedLines.join('\n'));
		},
	});
}

/**
 * Create a transformer that prefixes each line
 * @param prefix - Prefix to add to each line
 * @returns Transform stream that prefixes lines
 */
export function createPrefixTransformer(
	prefix: string,
): TransformStream<string, string> {
	return new TransformStream({
		transform(chunk, controller) {
			// Add prefix to each line
			const lines = chunk.split(/\r\n|\r|\n/);
			const prefixedLines = lines.map((line) => {
				return line ? `${prefix}${line}` : line;
			});

			controller.enqueue(prefixedLines.join('\n'));
		},
	});
}

/**
 * Create a transformer that filters lines based on a pattern
 * @param pattern - Regex pattern or string to match
 * @param include - Whether to include (true) or exclude (false) matching lines
 * @returns Transform stream that filters lines
 */
export function createFilterTransformer(
	pattern: RegExp | string,
	include = true,
): TransformStream<string, string> {
	const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);

	return new TransformStream({
		transform(chunk, controller) {
			// Filter lines based on pattern
			const lines = chunk.split(/\r\n|\r|\n/);
			const filteredLines = lines.filter((line) => {
				const matches = regex.test(line);
				return include ? matches : !matches;
			});

			if (filteredLines.length > 0) {
				controller.enqueue(filteredLines.join('\n'));
			}
		},
	});
}

/**
 * Create a transformer that formats output as a table
 * @param delimiter - Delimiter to split columns (default: "\t")
 * @param hasHeader - Whether the first row is a header (default: false)
 * @returns Transform stream that formats output as a table
 */
export function createTableTransformer(
	delimiter = '\t',
	hasHeader = false,
): TransformStream<string, string> {
	let rows: string[][] = [];
	let columnWidths: number[] = [];

	return new TransformStream({
		transform(chunk, controller) {
			// Split by lines and columns
			const lines = chunk.split(/\r\n|\r|\n/).filter((line) => line.trim());

			for (const line of lines) {
				const columns = line.split(delimiter);
				rows.push(columns);

				// Update column widths
				for (let i = 0; i < columns.length; i++) {
					const width = columns[i].length;
					if (!columnWidths[i] || width > columnWidths[i]) {
						columnWidths[i] = width;
					}
				}
			}

			// Format as table
			let tableOutput = '';

			// Create header separator if needed
			if (hasHeader && rows.length > 1) {
				const headerRow = rows[0];
				tableOutput += headerRow.map((col, i) => col.padEnd(columnWidths[i])).join(' | ') + '\n';

				tableOutput += columnWidths.map((width) => '─'.repeat(width)).join('─┼─') + '\n';

				// Format data rows
				for (let i = 1; i < rows.length; i++) {
					tableOutput += rows[i].map((col, j) => col.padEnd(columnWidths[j])).join(' | ') + '\n';
				}
			} else {
				// Format all rows the same way
				for (const row of rows) {
					tableOutput += row.map((col, i) => col.padEnd(columnWidths[i])).join(' | ') + '\n';
				}
			}

			controller.enqueue(tableOutput.trimEnd());

			// Reset for next chunk
			rows = [];
			columnWidths = [];
		},
	});
}

/**
 * Create a transformer that applies a custom function to each chunk
 * @param transformFn - Custom transform function
 * @returns Transform stream that applies the custom function
 */
export function createCustomTransformer(
	transformFn: (input: string) => string,
): TransformStream<string, string> {
	return new TransformStream({
		transform(chunk, controller) {
			try {
				const transformed = transformFn(chunk);
				controller.enqueue(transformed);
			} catch (error) {
				// If transform fails, pass through original
				console.error('Transform error:', error);
				controller.enqueue(chunk);
			}
		},
	});
}
