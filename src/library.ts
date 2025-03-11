/**
 * Converts a given string to lower Kebab case.
 * @param input - The string to convert.
 * @returns The converted lower kebab case string.
 */
export function toLowerKebabCase(input: string): string {
    if (!input) return "";

    // Replace any non-alphanumeric characters with spaces
    const normalized = input.replace(/[^\w\s]/g, " ");

    // Convert to lowercase, split by whitespace, and join with hyphens
    return normalized
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .join("-");
}
