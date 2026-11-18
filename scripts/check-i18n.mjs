import { parse, TYPE } from "@formatjs/icu-messageformat-parser";
import { readFileSync, readdirSync } from "node:fs";
import { sourceLocale, supportedLocales } from "../src/i18n/locales.ts";

const root = new URL("../src/i18n/messages/", import.meta.url);
const problems = [];

function readLocale(locale) {
  const directory = new URL(`${locale}/`, root);
  return new Map(readdirSync(directory).filter(name => name.endsWith(".json")).sort().flatMap(name => {
    const feature = name.slice(0, -5);
    const messages = JSON.parse(readFileSync(new URL(name, directory), "utf8"));
    return flatten(messages, feature, locale);
  }));
}

function flatten(messages, prefix, locale) {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = `${prefix}.${key}`;
    if (!key || key.includes(".")) {
      problems.push(`${locale}/${path}: each key must be a single nonempty path segment`);
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return flatten(value, path, locale);
    }
    return [[path, value]];
  });
}

function argumentsOf(message) {
  if (typeof message !== "string" || !message.trim()) throw new Error("expected a nonempty message");
  const args = new Set();
  function visit(elements) {
    for (const element of elements) {
      if (element.type === TYPE.tag) {
        args.add(`<${element.value}>`);
        visit(element.children);
      } else if (element.type !== TYPE.literal && element.type !== TYPE.pound) {
        args.add(element.value);
        if (element.type === TYPE.plural || element.type === TYPE.select) {
          for (const option of Object.values(element.options)) visit(option.value);
        }
      }
    }
  }
  visit(parse(message, { requiresOtherClause: true }));
  return [...args].sort().join(", ");
}

const source = readLocale(sourceLocale);
if (source.size === 0) problems.push(`${sourceLocale}: source catalog is empty`);
const argumentLists = new Map();
for (const [key, message] of source) {
  try { argumentLists.set(key, argumentsOf(message)); }
  catch (error) { problems.push(`${sourceLocale}/${key}: ${error.message}`); }
}

for (const locale of supportedLocales.filter(locale => locale !== sourceLocale)) {
  const messages = readLocale(locale);
  for (const key of messages.keys()) {
    if (!source.has(key)) problems.push(`${locale}/${key}: key is missing from ${sourceLocale}`);
  }
  for (const key of source.keys()) {
    if (!messages.has(key)) {
      problems.push(`${locale}/${key}: missing translation`);
      continue;
    }
    try {
      const args = argumentsOf(messages.get(key));
      if (argumentLists.has(key) && argumentLists.get(key) !== args) {
        problems.push(`${locale}/${key}: expected parameters [${argumentLists.get(key)}], found [${args}]`);
      }
    } catch (error) {
      problems.push(`${locale}/${key}: ${error.message}`);
    }
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`${source.size} messages verified in ${supportedLocales.length} locales.`);
}
