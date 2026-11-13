import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const slugsPath = path.join(frontendRoot, "config", "exercise-pages.json");
const templatePath = path.join(frontendRoot, "templates", "exercise-page.html");
const outputDirectory = path.join(frontendRoot, "pages", "exercises");

const slugs = JSON.parse(await readFile(slugsPath, "utf8"));
if (!Array.isArray(slugs) || slugs.length === 0) {
    throw new Error("Exercise page configuration must be a non-empty array of slugs.");
}

const uniqueSlugs = new Set();
for (const slug of slugs) {
    if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        throw new Error(`Invalid exercise page slug: ${slug}`);
    }
    if (uniqueSlugs.has(slug)) {
        throw new Error(`Duplicate exercise page slug: ${slug}`);
    }
    uniqueSlugs.add(slug);
}

const template = await readFile(templatePath, "utf8");
if (!template.includes("{{slug}}")) {
    throw new Error("Exercise page template must include the {{slug}} placeholder.");
}

await mkdir(outputDirectory, { recursive: true });
await Promise.all(slugs.map(async slug => {
    const page = `<!-- Generated from templates/exercise-page.html. Do not edit directly. -->\n${template.replaceAll("{{slug}}", slug)}`;
    await writeFile(path.join(outputDirectory, `${slug}.html`), page);
}));

console.log(`Generated ${slugs.length} exercise pages.`);
