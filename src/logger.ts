import debug from "debug";
import fs from "fs";
import path from "path";

// Define namespaces for different parts of the application
const NAMESPACE_BASE = "confluence-downloader";
const NAMESPACES = {
    api: `${NAMESPACE_BASE}:api`,
    converter: `${NAMESPACE_BASE}:converter`,
    library: `${NAMESPACE_BASE}:library`,
    cli: `${NAMESPACE_BASE}:cli`,
    interactive: `${NAMESPACE_BASE}:interactive`,
    downloader: `${NAMESPACE_BASE}:downloader`,
    db: `${NAMESPACE_BASE}:db`,
    contentWriter: `${NAMESPACE_BASE}:content-writer`,
};

// Define severity levels within each namespace
const LEVELS = {
    error: "error",
    warn: "warn",
    info: "info",
    debug: "debug",
    trace: "trace",
};

// Logger class for managing debug instances and file logging
export class Logger {
    private static fileStream: fs.WriteStream | null = null;
    private static logFilePath: string = "";
    private static isFileLoggingEnabled: boolean = false;

    // Create debug instances for each namespace and severity level
    private static debuggers: Record<string, Record<string, debug.Debugger>> = Object.fromEntries(
        Object.entries(NAMESPACES).map(([ns, nsValue]) => [
            ns,
            Object.fromEntries(
                Object.entries(LEVELS).map(([level, levelValue]) => [level, debug(`${nsValue}:${levelValue}`)]),
            ),
        ]),
    );

    /**
     * Initialize the logger with file logging if enabled
     */
    public static init(options: {
        logToFile?: boolean;
        logFilePath?: string;
        logDir?: string;
    } = {}): void {
        // Enable all namespaces by default if not already set
        if (!process.env.DEBUG) {
            process.env.DEBUG = `${NAMESPACE_BASE}:*`;
        }

        // Set up file logging if requested
        if (options.logToFile) {
            this.isFileLoggingEnabled = true;

            // Determine log file path
            if (options.logFilePath) {
                this.logFilePath = options.logFilePath;
            } else if (options.logDir) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                this.logFilePath = path.join(options.logDir, `debug-${timestamp}.log`);
            } else {
                const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                this.logFilePath = `debug-${timestamp}.log`;
            }

            // Ensure directory exists
            const logDir = path.dirname(this.logFilePath);
            fs.mkdirSync(logDir, { recursive: true });

            // Create write stream
            this.fileStream = fs.createWriteStream(this.logFilePath, { flags: "a" });

            // Redirect debug output to file in addition to console
            const originalWrite = process.stderr.write;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            process.stderr.write = function(chunk: any, encoding: any, callback?: any) {
                if (Logger.fileStream) {
                    Logger.fileStream.write(chunk, encoding);
                }
                return originalWrite.apply(process.stderr, [chunk, encoding, callback]);
            };

            // Log initialization
            this.info("cli", `Logger initialized with file output: ${this.logFilePath}`);
        }
    }

    /**
     * Close the logger file stream if it exists
     */
    public static close(): void {
        if (this.fileStream) {
            this.fileStream.end();
            this.fileStream = null;
        }
    }

    /**
     * Get the path to the current log file
     */
    public static getLogFilePath(): string {
        return this.logFilePath;
    }

    /**
     * Check if file logging is enabled
     */
    public static isFileLogging(): boolean {
        return this.isFileLoggingEnabled;
    }

    // Logging methods for each severity level
    public static error(namespace: keyof typeof NAMESPACES, message: string, data?: unknown): void {
        const debugInstance = this.debuggers[namespace]?.error;
        if (debugInstance) {
            if (data) {
                debugInstance(`${message}`, data);
            } else {
                debugInstance(message);
            }
        }
    }

    public static warn(namespace: keyof typeof NAMESPACES, message: string, data?: unknown): void {
        const debugInstance = this.debuggers[namespace]?.warn;
        if (debugInstance) {
            if (data) {
                debugInstance(`${message}`, data);
            } else {
                debugInstance(message);
            }
        }
    }

    public static info(namespace: keyof typeof NAMESPACES, message: string, data?: unknown): void {
        const debugInstance = this.debuggers[namespace]?.info;
        if (debugInstance) {
            if (data) {
                debugInstance(`${message}`, data);
            } else {
                debugInstance(message);
            }
        }
    }

    public static debug(namespace: keyof typeof NAMESPACES, message: string, data?: unknown): void {
        const debugInstance = this.debuggers[namespace]?.debug;
        if (debugInstance) {
            if (data) {
                debugInstance(`${message}`, data);
            } else {
                debugInstance(message);
            }
        }
    }

    public static trace(namespace: keyof typeof NAMESPACES, message: string, data?: unknown): void {
        const debugInstance = this.debuggers[namespace]?.trace;
        if (debugInstance) {
            if (data) {
                debugInstance(`${message}`, data);
            } else {
                debugInstance(message);
            }
        }
    }
}

// Export namespaces and levels for use elsewhere
export const LogNamespace = NAMESPACES;
export const LogLevel = LEVELS;

// Default export for convenience
export default Logger;
