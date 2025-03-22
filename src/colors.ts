/**
 * Terminal color utilities for consistent shell output formatting
 * Provides type-safe color functions for different output categories
 */

import * as rt from 'runtypes';

// ANSI color code constants
const ESC = '\x1b';
const CSI = ESC + '[';
const RESET = CSI + '0m';

// Text styles
const BOLD = CSI + '1m';
const DIM = CSI + '2m';
const ITALIC = CSI + '3m';
const UNDERLINE = CSI + '4m';

// Foreground colors
const FG_BLACK = CSI + '30m';
const FG_RED = CSI + '31m';
const FG_GREEN = CSI + '32m';
const FG_YELLOW = CSI + '33m';
const FG_BLUE = CSI + '34m';
const FG_MAGENTA = CSI + '35m';
const FG_CYAN = CSI + '36m';
const FG_WHITE = CSI + '37m';
const FG_GRAY = CSI + '90m';

// Background colors
const BG_BLACK = CSI + '40m';
const BG_RED = CSI + '41m';
const BG_GREEN = CSI + '42m';
const BG_YELLOW = CSI + '43m';
const BG_BLUE = CSI + '44m';
const BG_MAGENTA = CSI + '45m';
const BG_CYAN = CSI + '46m';
const BG_WHITE = CSI + '47m';

/**
 * Color name to ANSI code mapping
 */
const FG_COLORS: Record<string, string> = {
	black: FG_BLACK,
	red: FG_RED,
	green: FG_GREEN,
	yellow: FG_YELLOW,
	blue: FG_BLUE,
	magenta: FG_MAGENTA,
	cyan: FG_CYAN,
	white: FG_WHITE,
	gray: FG_GRAY,
	grey: FG_GRAY,
	bold: BOLD,
};

/**
 * Color theme definition for terminal output
 */
export const ColorThemeConfig = rt.Record({
	// Command output formatting
	command: rt.Record({
		success: rt.String,
		info: rt.String,
		warning: rt.String,
		executing: rt.String,
	}),

	// Error message colors
	error: rt.Record({
		title: rt.String,
		message: rt.String,
		hint: rt.String,
	}),

	// Help text formatting
	help: rt.Record({
		title: rt.String,
		command: rt.String,
		description: rt.String,
		example: rt.String,
	}),

	// Utility colors
	utility: rt.Record({
		highlight: rt.String,
		dim: rt.String,
		border: rt.String,
		header: rt.String,
	}),
});

/**
 * TypeScript type derived from ColorThemeConfig runtime type
 */
export type ColorTheme = rt.Static<typeof ColorThemeConfig>;

/**
 * Default color theme for terminal output
 */
export const defaultTheme: ColorTheme = {
	command: {
		success: 'green',
		info: 'cyan',
		warning: 'yellow',
		executing: 'blue',
	},
	error: {
		title: 'red',
		message: 'white',
		hint: 'yellow',
	},
	help: {
		title: 'magenta',
		command: 'cyan',
		description: 'white',
		example: 'green',
	},
	utility: {
		highlight: 'cyan',
		dim: 'gray',
		border: 'gray',
		header: 'bold',
	},
};

/**
 * Current active color theme
 */
let activeTheme: ColorTheme = defaultTheme;

/**
 * Set a custom color theme
 * @param theme - The custom color theme to use
 */
export function setColorTheme(theme: ColorTheme): void {
	try {
		// Validate theme with runtime type checking
		ColorThemeConfig.check(theme);
		activeTheme = theme;
	} catch (error) {
		console.error(`Invalid color theme: ${error.message}`);
	}
}

/**
 * Apply a color to text
 * @param colorName - The color name to apply
 * @param text - The text to color
 * @returns Formatted colored string
 */
function colorize(colorName: string, text: string): string {
	const colorCode = FG_COLORS[colorName.toLowerCase()] || '';
	return `${colorCode}${text}${RESET}`;
}

/**
 * Apply bold formatting to text
 * @param text - The text to format
 * @returns Bold formatted string
 */
function bold(text: string): string {
	return `${BOLD}${text}${RESET}`;
}

/**
 * Format success command output
 * @param message - The success message to format
 * @returns Formatted colored string
 */
export function formatSuccess(message: string): string {
	return colorize(activeTheme.command.success, message);
}

/**
 * Format informational command output
 * @param message - The info message to format
 * @returns Formatted colored string
 */
export function formatInfo(message: string): string {
	return colorize(activeTheme.command.info, message);
}

/**
 * Format warning command output
 * @param message - The warning message to format
 * @returns Formatted colored string
 */
export function formatWarning(message: string): string {
	return colorize(activeTheme.command.warning, message);
}

/**
 * Format command execution status
 * @param message - The execution status message to format
 * @returns Formatted colored string
 */
export function formatExecuting(message: string): string {
	return colorize(activeTheme.command.executing, message);
}

/**
 * Format error message with title, message, and optional hint
 * @param title - Error title/category
 * @param message - Detailed error message
 * @param hint - Optional hint for resolving the error
 * @returns Formatted multi-line colored error string
 */
export function formatError(title: string, message: string, hint?: string): string {
	const errorTitle = colorize(activeTheme.error.title, title);
	const errorMessage = colorize(activeTheme.error.message, message);
	let output = `${errorTitle}: ${errorMessage}`;

	if (hint) {
		output += `\n${colorize(activeTheme.error.hint, hint)}`;
	}

	return output;
}

/**
 * Format command name in help text
 * @param command - The command name to format
 * @returns Formatted colored string
 */
export function formatHelpCommand(command: string): string {
	return colorize(activeTheme.help.command, command);
}

/**
 * Format command description in help text
 * @param description - The description to format
 * @returns Formatted colored string
 */
export function formatHelpDescription(description: string): string {
	return colorize(activeTheme.help.description, description);
}

/**
 * Format help text title
 * @param title - The title to format
 * @returns Formatted colored string
 */
export function formatHelpTitle(title: string): string {
	// Apply both bold and color formatting to title
	return bold(colorize(activeTheme.help.title, title));
}

/**
 * Format example command in help text
 * @param example - The example to format
 * @returns Formatted colored string
 */
export function formatHelpExample(example: string): string {
	return colorize(activeTheme.help.example, example);
}

/**
 * Format highlighted text
 * @param text - The text to highlight
 * @returns Formatted colored string
 */
export function highlight(text: string): string {
	return colorize(activeTheme.utility.highlight, text);
}

/**
 * Format dimmed text (less emphasized)
 * @param text - The text to dim
 * @returns Formatted colored string
 */
export function dim(text: string): string {
	return colorize(activeTheme.utility.dim, text);
}

/**
 * Format a section header
 * @param text - The header text
 * @returns Formatted colored string
 */
export function header(text: string): string {
	// If header is set to bold, apply bold formatting directly
	if (activeTheme.utility.header === 'bold') {
		return bold(text);
	}
	// Otherwise apply the color with bold formatting
	return bold(colorize(activeTheme.utility.header, text));
}

/**
 * Create a simple border line with optional title
 * @param width - Width of the border
 * @param title - Optional title to include in the border
 * @returns Formatted border string
 */
export function border(width: number, title?: string): string {
	const borderChar = '─';

	if (!title) {
		return colorize(activeTheme.utility.border, borderChar.repeat(width));
	}

	const formattedTitle = ` ${title} `;
	const sideWidth = Math.floor((width - formattedTitle.length) / 2);
	const leftBorder = borderChar.repeat(Math.max(0, sideWidth));
	const rightBorder = borderChar.repeat(Math.max(0, width - sideWidth - formattedTitle.length));

	return colorize(activeTheme.utility.border, leftBorder) +
		highlight(formattedTitle) +
		colorize(activeTheme.utility.border, rightBorder);
}
